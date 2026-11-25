-- A service-only synthetic matching transition. The same private candidate
-- predicate drives the aggregate feasibility read and each offer.
create or replace function internal.gate2_marketplace_candidates(supplied_study_id uuid)
returns table (respondent_id uuid) language sql volatile security definer
set search_path = '' as $$
    select candidate.id
    from public.studies as target
    join public.respondents as candidate on candidate.status = 'active'
    join auth.users as account on account.id = candidate.auth_user_id
        and account.email_confirmed_at is not null
    where target.id = supplied_study_id
        and (select count(distinct fact.key) from public.profile_attributes as fact
            where fact.respondent_id = candidate.id and fact.key = any(array[
                'age_range', 'gender', 'student_year', 'lives_on_campus',
                'online_shopping_frequency', 'region_zip',
                'food_orders_per_week', 'interests'])) = 8
        and internal.gate1_consent(candidate.id, target.id, 'retention')
        and internal.gate1_consent(candidate.id, target.id, 'researcher_access')
        and not exists (select 1 from public.invites as offer
            where offer.respondent_id = candidate.id and (
                offer.study_id = target.id or
                (offer.state in ('matched', 'screening', 'invited', 'accepted')
                    and offer.expires_at > clock_timestamp()) or
                (offer.state = 'accepted' and exists (
                    select 1 from public.sessions as ongoing
                    where ongoing.invite_id = offer.id
                        and ongoing.state in ('started', 'in_progress')))))
        and not exists (select 1 from public.criteria as criterion
            where criterion.study_id = target.id and criterion.kind in ('must', 'exclude')
                and (criterion.kind = 'must') is distinct from exists (
                    select 1 from public.profile_attributes as fact
                    where fact.respondent_id = candidate.id
                        and fact.key = criterion.attribute_key
                        and internal.gate1_predicate_matches(
                            fact.value_json, criterion.operator, criterion.value_json)))
        and (select count(*) from public.sessions as interview
            join public.invites as offer on offer.id = interview.invite_id
            where offer.respondent_id = candidate.id
                and interview.submitted_at > clock_timestamp() - interval '7 days') < 3
        and not exists (select 1 from public.sessions as interview
            join public.invites as offer on offer.id = interview.invite_id
            join public.studies as previous on previous.id = offer.study_id
            where offer.respondent_id = candidate.id
                and target.labels <> '[]'::jsonb
                and previous.labels @> target.labels
                and interview.submitted_at > clock_timestamp() - interval '30 days');
$$;

create function public.create_gate2_marketplace_offers(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_auth_user_id uuid, requested_count integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    line jsonb;
    candidate_id uuid;
    made_id uuid;
    made_count integer := 0;
    occupied integer;
    room integer;
    offer_state text;
    expires timestamptz;
begin
    if requested_count is null or requested_count < 1 or requested_count > 100
    then raise check_violation; end if;
    -- Gate 1's preview assignment uses this same lock. One matcher at a time
    -- then takes the study row, followed by each respondent row.
    perform pg_catalog.pg_advisory_xact_lock(1127944272, 1);
    select * into target from public.studies
        where id = supplied_study_id for update;
    if not found or target.state <> 'fielding' or target.target_completes < 10
        or target.deadline_at is null or target.deadline_at <= clock_timestamp()
        or not exists (select 1 from public.researchers as researcher
            where researcher.organization_id = target.organization_id
                and researcher.auth_user_id = supplied_auth_user_id)
    then raise check_violation; end if;
    select * into frozen from public.gate2_quote_snapshots
        where id = supplied_quote_id and study_id = target.id for share;
    if not found or frozen.pricing_config_version < 101
        or frozen.guide_digest is distinct from public.gate2_guide_digest(target.id)
        or frozen.brief_version is distinct from (
            select max(version) from public.brief_versions where study_id = target.id)
        or jsonb_array_length(frozen.line_items_json) <> 1
        or not exists (select 1 from public.audit_log as launch
            where launch.entity = 'study' and launch.entity_id = target.id
                and launch.from_state = 'awaiting_payment'
                and launch.to_state = 'fielding'
                and launch.meta ->> 'quoteId' = frozen.id::text)
        or exists (select 1 from public.gate2_payment_events as event
            where event.quote_id = frozen.id and event.event_kind in ('failed', 'refunded'))
    then raise check_violation; end if;
    line := frozen.line_items_json -> 0;
    if line ->> 'label' is distinct from 'Core questions'
        or (line ->> 'respondentCount') !~ '^[0-9]+$'
        or (line ->> 'coreQuestionCount') !~ '^[0-9]+$'
        or (line ->> 'unitPriceCents') is distinct from '200'
        or (line ->> 'respondentCount')::integer <> target.target_completes
        or frozen.incentive_cents_per_complete <>
            (line ->> 'coreQuestionCount')::integer * 100
        or frozen.total_cents <> target.target_completes *
            (line ->> 'coreQuestionCount')::integer * 200
    then raise check_violation; end if;
    select count(*) into occupied from public.invites as offer
        where offer.study_id = target.id
            and ((offer.state in ('matched', 'screening', 'invited', 'accepted')
                    and offer.expires_at > clock_timestamp())
                or exists (select 1 from public.sessions as interview
                    where interview.invite_id = offer.id
                        and interview.state in ('started', 'in_progress',
                            'submitted', 'quality_hold', 'approved', 'paid')));
    room := greatest(0, target.target_completes - occupied);
    if room = 0 then return jsonb_build_object('created', 0, 'remaining', 0); end if;
    offer_state := case when exists (select 1
        from public.gate2_screening_rules as rule
        where rule.study_id = target.id and rule.approved_at <= clock_timestamp())
        then 'screening' else 'invited' end;
    expires := least(target.deadline_at, clock_timestamp() + interval '24 hours');
    for candidate_id in
        select eligible.respondent_id
        from internal.gate2_marketplace_candidates(target.id) as eligible
        order by (select count(*) from public.criteria as preference
            join public.profile_attributes as fact
                on fact.respondent_id = eligible.respondent_id
                    and fact.key = preference.attribute_key
            where preference.study_id = target.id and preference.kind = 'nice'
                and internal.gate1_predicate_matches(fact.value_json,
                    preference.operator, preference.value_json)) desc,
            eligible.respondent_id
    loop
        exit when made_count >= least(requested_count, room);
        perform 1 from public.respondents where id = candidate_id for update;
        -- Recheck after the respondent lock. Consent, profile, capacity or a
        -- competing offer can change between selection and insertion.
        if not exists (select 1 from internal.gate2_marketplace_candidates(target.id)
            where respondent_id = candidate_id)
        then continue; end if;
        insert into public.invites (study_id, respondent_id, state,
            reward_cents, expires_at, why_you_text)
        values (target.id, candidate_id, offer_state,
            frozen.incentive_cents_per_complete, expires,
            'Your profile matches this study.') returning id into made_id;
        insert into public.audit_log (entity, entity_id, from_state, to_state,
            actor, meta) values ('invite', made_id, 'matched', offer_state,
            'platform', jsonb_build_object('quoteId', frozen.id));
        made_count := made_count + 1;
    end loop;
    return jsonb_build_object('created', made_count,
        'remaining', room - made_count);
end;
$$;
revoke all on function public.create_gate2_marketplace_offers(uuid, uuid, uuid, integer)
    from public, anon, authenticated, service_role;
grant execute on function public.create_gate2_marketplace_offers(uuid, uuid, uuid, integer)
    to service_role;
