-- Private, single-snapshot earnings. A referral vesting is shown as vested,
-- never as a delivered Visa payout. Unapproved answers do not enter totals.
create function public.read_gate2_current_respondent_earnings()
returns jsonb language sql stable security definer set search_path = '' as $$
    with owner as (
        select id from public.respondents
        where auth_user_id = auth.uid() and status <> 'deleted'
    ), items as (
        select interview.id as session_id, interview.study_id,
            coalesce(payout.amount_cents,
                internal.gate2_marketplace_earned_cents(interview.id)) as earned_cents,
            coalesce(payout.state, 'awaiting_reservation') as payout_status,
            payout.id as payout_id
        from owner
        join public.invites as offer on offer.respondent_id = owner.id
        join public.sessions as interview on interview.invite_id = offer.id
        left join lateral (
            select id, amount_cents, state from public.payouts
            where session_id = interview.id
            order by created_at desc, id desc limit 1
        ) as payout on true
        where interview.state in ('approved', 'paid')
            and exists (select 1 from public.gate2_quote_snapshots as quote
                join public.gate2_payment_events as paid
                    on paid.quote_id = quote.id and paid.event_kind = 'paid'
                where quote.study_id = interview.study_id
                    and quote.pricing_config_version >= 101)
    ), totals as (
        select coalesce(sum(earned_cents) filter (where earned_cents > 0), 0)::integer
                as earned_cents,
            coalesce(sum(earned_cents) filter (
                where payout_status = 'delivered'), 0)::integer as delivered_cents,
            coalesce(jsonb_agg(jsonb_build_object(
                'sessionId', session_id, 'studyId', study_id,
                'earnedCents', earned_cents, 'payoutStatus', payout_status)
                order by session_id) filter (where earned_cents > 0), '[]'::jsonb)
                as sessions
        from items
    )
    select jsonb_build_object('currency', 'usd',
        'earnedCents', totals.earned_cents,
        'deliveredCents', totals.delivered_cents,
        'sessions', totals.sessions,
        'referral', jsonb_build_object(
            'verifiedProfiles', (select count(*) from
                public.gate2_referral_profile_verifications as verified
                where verified.referrer_id = owner.id),
            'vestedBonusCents', coalesce((select bonus_cents from
                public.gate2_referral_vestings as vested
                where vested.referrer_id = owner.id), 0)))
    from owner cross join totals;
$$;
revoke all on function public.read_gate2_current_respondent_earnings()
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_current_respondent_earnings()
    to authenticated;
