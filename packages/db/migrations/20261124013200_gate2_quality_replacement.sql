-- Explicit reviewed quality decisions are atomic with a capacity-bounded
-- replacement wave. Automatic scoring and removal policy are not enabled.
revoke insert, update, delete on public.quality_scores, public.removals
    from service_role;
alter table public.invites drop constraint invites_state_check;
alter table public.invites add constraint invites_state_check check (state in (
    'matched', 'screening', 'invited', 'accepted', 'declined', 'expired',
    'screened_out', 'removed'));

create function internal.gate2_guard_quality_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if old.state in ('submitted', 'quality_hold')
        and new.state in ('approved', 'removed')
        and exists (select 1 from public.gate2_quote_snapshots as quote
            where quote.study_id = old.study_id
                and quote.pricing_config_version >= 101)
        and not exists (select 1 from public.quality_scores as score
            where score.session_id = old.id
                and score.decision = case when new.state = 'approved'
                    then 'approve' else 'remove' end)
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_quality_transition()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_quality_transition
    before update of state on public.sessions for each row
    execute function internal.gate2_guard_quality_transition();

create function public.decide_gate2_marketplace_quality(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_session_id uuid, supplied_actor_auth_id uuid,
    supplied_decision text, supplied_score integer,
    supplied_components jsonb, supplied_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    interview public.sessions%rowtype;
    actor_id uuid;
    prior public.quality_scores%rowtype;
    prior_removal public.removals%rowtype;
    wave jsonb := null;
    expected_state text;
begin
    if supplied_decision not in ('approve', 'remove')
        or supplied_score is null or supplied_score not between 0 and 100
        or supplied_components is null or jsonb_typeof(supplied_components) <> 'object'
        or (supplied_decision = 'remove' and nullif(btrim(supplied_reason), '') is null)
        or (supplied_decision = 'approve' and supplied_reason is not null)
    then raise check_violation; end if;
    expected_state := case when supplied_decision = 'approve'
        then 'approved' else 'removed' end;
    perform pg_catalog.pg_advisory_xact_lock(1127944272, 1);
    select * into target from public.studies
        where id = supplied_study_id for update;
    if not found or target.state <> 'fielding' then raise check_violation; end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = supplied_quote_id and study_id = target.id for share;
    if not found or frozen.pricing_config_version < 101
        or not exists (select 1 from public.gate2_payment_events as paid
            where paid.quote_id = frozen.id and paid.event_kind = 'paid')
    then raise check_violation; end if;
    select researcher.id into actor_id from public.researchers as researcher
    where researcher.auth_user_id = supplied_actor_auth_id
        and researcher.organization_id = target.organization_id;
    if actor_id is null then raise insufficient_privilege; end if;
    select * into interview from public.sessions
        where id = supplied_session_id and study_id = target.id for update;
    if not found or interview.submitted_at is null
        or interview.state not in ('submitted', 'quality_hold', 'approved', 'removed')
    then raise check_violation; end if;
    select * into prior from public.quality_scores
        where session_id = interview.id;
    if found then
        if prior.decision <> supplied_decision or prior.score <> supplied_score
            or prior.components_json <> supplied_components
            or prior.decided_by <> actor_id
            or interview.state <> expected_state
        then raise check_violation; end if;
        if supplied_decision = 'remove' then
            select * into prior_removal from public.removals
                where session_id = interview.id;
            if not found or prior_removal.reason <> supplied_reason
            then raise check_violation; end if;
        end if;
    else
        if interview.state not in ('submitted', 'quality_hold')
            or not exists (select 1 from public.invites as offer
                where offer.id = interview.invite_id and offer.state = 'accepted')
        then raise check_violation; end if;
        insert into public.quality_scores
            (session_id, score, components_json, decision, decided_by)
        values (interview.id, supplied_score, supplied_components,
            supplied_decision, actor_id);
        if supplied_decision = 'remove' then
            insert into public.removals (session_id, reason)
            values (interview.id, supplied_reason);
            update public.invites set state = 'removed',
                expires_at = clock_timestamp() where id = interview.invite_id;
            insert into public.audit_log (entity, entity_id, from_state,
                to_state, actor, meta)
            values ('invite', interview.invite_id, 'accepted', 'removed',
                'researcher', jsonb_build_object('researcherId', actor_id,
                    'sessionId', interview.id));
        end if;
        update public.sessions set state = expected_state where id = interview.id;
        insert into public.audit_log (entity, entity_id, from_state,
            to_state, actor, meta)
        values ('session', interview.id, interview.state,
            expected_state,
            'researcher', jsonb_build_object('researcherId', actor_id,
                'qualityScore', supplied_score, 'quoteId', frozen.id));
    end if;
    if supplied_decision = 'remove' and target.deadline_at > clock_timestamp()
    then wave := public.create_gate2_marketplace_offers(target.id, frozen.id,
        supplied_actor_auth_id, 1); end if;
    return jsonb_build_object('decision', supplied_decision,
        'sessionId', interview.id, 'replacement', wave);
end;
$$;
revoke all on function public.decide_gate2_marketplace_quality(
    uuid, uuid, uuid, uuid, text, integer, jsonb, text)
    from public, anon, authenticated, service_role;
grant execute on function public.decide_gate2_marketplace_quality(
    uuid, uuid, uuid, uuid, text, integer, jsonb, text)
    to service_role;
