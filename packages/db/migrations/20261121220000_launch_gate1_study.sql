create function internal.gate1_predicate_matches(actual jsonb, operation text, expected jsonb)
returns boolean language sql immutable strict set search_path = pg_catalog
as $$
    select case operation
        when 'eq' then actual = expected
        when 'gte' then jsonb_typeof(actual) = 'number' and jsonb_typeof(expected) = 'number' and actual >= expected
        else false
    end;
$$;

revoke all on function internal.gate1_predicate_matches(jsonb, text, jsonb) from public, anon, authenticated;

create function public.launch_gate1_study(supplied_researcher_id uuid, supplied_organization_id uuid, supplied_study_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    target public.studies%rowtype;
    launched_at timestamptz;
    incentive jsonb;
    reward integer;
    invite_count integer;
    cohort_label constant jsonb := '["gate1_food"]'::jsonb;
begin
    perform 1 from public.researchers
    where id = supplied_researcher_id and organization_id = supplied_organization_id for share;
    if not found then raise insufficient_privilege; end if;

    -- Serialize preview launches across studies so a respondent is assigned only once.
    perform pg_catalog.pg_advisory_xact_lock(1127944272, 1);
    launched_at := clock_timestamp();
    select * into target from public.studies
    where id = supplied_study_id and organization_id = supplied_organization_id for update;
    if not found then raise insufficient_privilege; end if;

    if target.state = 'fielding' and exists (
        select 1 from public.audit_log
        where entity = 'study' and entity_id = target.id and to_state = 'fielding'
            and meta @> '{"skip_payment":true}'::jsonb
    ) then
        return jsonb_build_object('studyId', target.id, 'state', target.state);
    end if;
    if target.state <> 'draft'
        or (select count(*) from public.guide_questions where study_id = target.id) <> 4
        or (select count(*) from public.criteria where study_id = target.id) <> 2
        or not exists (select 1 from public.criteria where study_id = target.id and kind = 'must')
        or exists (
            select 1 from public.criteria where study_id = target.id
                and (operator not in ('eq', 'gte') or (operator = 'gte' and jsonb_typeof(value_json) <> 'number'))
        )
    then raise check_violation; end if;

    select config.params_json -> 'incentivePerQuestionCents' into incentive
    from public.organizations as organization
    join public.pricing_configs as config
      on config.id = organization.pricing_override_id or (organization.pricing_override_id is null and config.active)
    where organization.id = supplied_organization_id;
    if jsonb_typeof(incentive) is distinct from 'number'
        or incentive::text !~ '^(0|[1-9][0-9]{0,8})$'
    then raise check_violation; end if;
    if (incentive::text)::integer > 536870911 then raise check_violation; end if;
    reward := (incentive::text)::integer * 4;

    with eligible as (
        select candidate.id
        from public.respondents as candidate
        where candidate.status = 'active'
            and not exists (
                select 1 from public.invites as offer
                where offer.respondent_id = candidate.id and (
                    offer.study_id = target.id
                    or (offer.state in ('matched', 'screening', 'invited') and offer.expires_at > launched_at)
                    or (offer.state = 'accepted' and offer.expires_at > launched_at and not exists (
                        select 1 from public.sessions as finished where finished.invite_id = offer.id
                            and finished.state not in ('started', 'in_progress')
                    ))
                )
            )
            and not exists (
                select 1 from public.criteria as predicate
                where predicate.study_id = target.id and predicate.kind in ('must', 'exclude')
                and (predicate.kind = 'must') is distinct from exists (
                    select 1 from public.profile_attributes as fact
                    where fact.respondent_id = candidate.id and fact.key = predicate.attribute_key
                        and internal.gate1_predicate_matches(fact.value_json, predicate.operator, predicate.value_json)
                )
            )
            and (select count(*) from public.sessions as interview
                join public.invites as prior on prior.id = interview.invite_id
                where prior.respondent_id = candidate.id
                    and interview.submitted_at > launched_at - interval '7 days') < 3
            and not exists (
                select 1 from public.sessions as interview
                join public.invites as prior on prior.id = interview.invite_id
                join public.studies as previous on previous.id = interview.study_id
                where prior.respondent_id = candidate.id and previous.labels @> cohort_label
                    and interview.submitted_at > launched_at - interval '30 days'
            )
        order by (
            select count(*) from public.criteria as preference
            join public.profile_attributes as fact on fact.respondent_id = candidate.id and fact.key = preference.attribute_key
            where preference.study_id = target.id and preference.kind = 'nice'
                and internal.gate1_predicate_matches(fact.value_json, preference.operator, preference.value_json)
        ) desc, candidate.id
        limit target.target_completes
    ), sent as (
        insert into public.invites (study_id, respondent_id, state, reward_cents, expires_at, why_you_text)
        select target.id, eligible.id, 'invited', reward, launched_at + interval '24 hours',
            'Your profile matches this study.'
        from eligible
        returning id
    )
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor)
    select 'invite', id, 'matched', 'invited', 'platform' from sent;

    get diagnostics invite_count = row_count;
    if invite_count = 0 then raise no_data_found; end if;

    update public.studies
    set state = 'fielding', labels = case when labels @> cohort_label then labels else labels || cohort_label end
    where id = target.id;
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor, meta)
    values ('study', target.id, 'draft', 'fielding', supplied_researcher_id::text,
        jsonb_build_object('skip_payment', true, 'invites_sent', invite_count));
    return jsonb_build_object('studyId', target.id, 'state', 'fielding');
end;
$$;

revoke all on function public.launch_gate1_study(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.launch_gate1_study(uuid, uuid, uuid) to service_role;
