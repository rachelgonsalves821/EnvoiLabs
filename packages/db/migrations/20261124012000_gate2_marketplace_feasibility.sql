-- Aggregate-only feasibility for a reviewed marketplace study. The same
-- candidate function is reserved for the paid matching transition.
create function internal.gate2_marketplace_candidates(supplied_study_id uuid)
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
                (offer.state in ('matched', 'screening', 'invited')
                    and offer.expires_at > clock_timestamp()) or
                (offer.state = 'accepted' and offer.expires_at > clock_timestamp()
                    and not exists (select 1 from public.sessions as finished
                        where finished.invite_id = offer.id
                            and finished.state not in ('started', 'in_progress')))))
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
revoke all on function internal.gate2_marketplace_candidates(uuid)
    from public, anon, authenticated, service_role;

create function public.read_gate2_marketplace_feasibility(
    supplied_study_id uuid, supplied_auth_user_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    eligible_count integer;
    offered_count integer;
    accepted_count integer;
    completed_count integer;
    projection integer;
    sampled boolean;
begin
    select study.* into target from public.studies as study
    join public.researchers as researcher
        on researcher.organization_id = study.organization_id
    where study.id = supplied_study_id
        and researcher.auth_user_id = supplied_auth_user_id
        and study.state in ('brief_ready', 'awaiting_payment');
    if not found then raise insufficient_privilege; end if;
    select count(*) into eligible_count
    from internal.gate2_marketplace_candidates(target.id);
    select count(distinct offer.id),
        count(distinct offer.id) filter (where offer.state = 'accepted'
            or interview.id is not null),
        count(distinct interview.id) filter (where interview.submitted_at is not null)
    into offered_count, accepted_count, completed_count
    from internal.gate2_marketplace_candidates(target.id) as candidate
    join public.invites as offer on offer.respondent_id = candidate.respondent_id
        and offer.study_id <> target.id
    left join public.sessions as interview on interview.invite_id = offer.id;
    sampled := offered_count >= 30 and accepted_count >= 10;
    if sampled then
        projection := floor(eligible_count::numeric * completed_count / offered_count);
    end if;
    return jsonb_build_object(
        'studyId', target.id, 'eligibleProfileCount', eligible_count,
        'history', jsonb_build_object('offered', offered_count,
            'accepted', accepted_count, 'completed', completed_count),
        'projectedCompletes', projection, 'fillHours', null,
        'basis', case when sampled then 'observed_rates' else 'insufficient_history' end,
        'asOf', to_char(clock_timestamp() at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;
revoke all on function public.read_gate2_marketplace_feasibility(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_marketplace_feasibility(uuid, uuid)
    to service_role;
