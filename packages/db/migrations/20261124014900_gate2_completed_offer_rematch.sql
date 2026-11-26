-- A completed, approved study frees its respondent for a later marketplace
-- offer even while the old accepted offer's 24-hour URL has not expired.
-- In-progress and unreviewed sessions still occupy the respondent.
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
                (offer.state in ('matched', 'screening', 'invited')
                    and offer.expires_at > clock_timestamp()) or
                (offer.state = 'accepted' and not exists (
                    select 1 from public.sessions as finished
                    where finished.invite_id = offer.id
                        and finished.state in ('approved', 'paid', 'removed')))))
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
