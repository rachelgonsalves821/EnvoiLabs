-- Marketplace payouts use the frozen per-core-question reward. Probe answers
-- and repeated answers to the same core question never increase earnings.
create function internal.gate2_marketplace_earned_cents(requested_session_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
    frozen public.gate2_quote_snapshots%rowtype;
    core_count integer;
    offered_reward integer;
    answered_count integer;
begin
    select quote.* into frozen
    from public.sessions as interview
    join public.gate2_quote_snapshots as quote on quote.study_id = interview.study_id
    where interview.id = requested_session_id and interview.state = 'approved'
        and quote.pricing_config_version >= 101
        and exists (select 1 from public.gate2_payment_events as paid
            where paid.quote_id = quote.id and paid.event_kind = 'paid')
    order by quote.created_at desc, quote.id desc limit 1;
    if not found then return null; end if;
    select offer.reward_cents into offered_reward
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    where interview.id = requested_session_id;
    core_count := (frozen.line_items_json -> 0 ->> 'coreQuestionCount')::integer;
    if core_count is null or core_count <= 0
        or frozen.incentive_cents_per_complete <> core_count * 100
        or offered_reward <> frozen.incentive_cents_per_complete
    then return null; end if;
    select count(distinct answer.guide_question_id) into answered_count
    from public.answers as answer
    join public.transcripts as transcript on transcript.answer_id = answer.id
    join pii.transcript_raw as raw on raw.transcript_id = transcript.id
    where answer.session_id = requested_session_id and answer.probe_id is null
        and btrim(raw.raw_text) <> '';
    if answered_count < 1 or answered_count > core_count then return null; end if;
    return answered_count * 100;
end;
$$;
revoke all on function internal.gate2_marketplace_earned_cents(uuid)
    from public, anon, authenticated, service_role;

create or replace function public.reserve_gate2_session_payout(
    requested_session_id uuid, requested_respondent_id uuid,
    requested_amount_cents integer, annual_cap_cents integer,
    requested_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    existing public.payouts%rowtype;
    approved_reward integer;
    delivered_cents bigint;
    outstanding_cents bigint;
    current_year integer;
    reserved_id uuid;
begin
    if requested_amount_cents is null or requested_amount_cents <= 0
        or annual_cap_cents is null or annual_cap_cents <= 0 or annual_cap_cents > 200000
        or requested_key is distinct from 'payout:' || requested_session_id::text
    then raise check_violation; end if;

    perform 1 from public.respondents where id = requested_respondent_id
        and status = 'active' for update;
    if not found then raise insufficient_privilege; end if;

    select * into existing from public.payouts where idempotency_key = requested_key;
    if found then
        if existing.respondent_id <> requested_respondent_id
            or existing.session_id is distinct from requested_session_id
            or existing.amount_cents <> requested_amount_cents
        then raise unique_violation; end if;
        return existing.id;
    end if;

    select offer.reward_cents into approved_reward
    from public.sessions as interview
    join public.invites as offer on offer.id = interview.invite_id
    where interview.id = requested_session_id and interview.state = 'approved'
        and interview.submitted_at <= now() - interval '24 hours'
        and offer.respondent_id = requested_respondent_id
    for update of interview;
    if not found then raise check_violation; end if;

    if exists (select 1 from public.gate2_quote_snapshots as marketplace
        where marketplace.study_id = (select study_id from public.sessions
            where id = requested_session_id)
            and marketplace.pricing_config_version >= 101)
    then
        approved_reward := internal.gate2_marketplace_earned_cents(requested_session_id);
    end if;
    if approved_reward is distinct from requested_amount_cents
    then raise check_violation; end if;

    current_year := extract(year from now() at time zone 'UTC')::integer;
    select coalesce(sum(amount_cents) filter (where state = 'delivered'
        and created_at >= make_timestamptz(current_year, 1, 1, 0, 0, 0, 'UTC')
        and created_at < make_timestamptz(current_year + 1, 1, 1, 0, 0, 0, 'UTC')), 0),
        coalesce(sum(amount_cents) filter (where state in ('pending', 'ordered')), 0)
        into delivered_cents, outstanding_cents
    from public.payouts where respondent_id = requested_respondent_id;
    if greatest(delivered_cents, (select case when ytd_payout_year = current_year
        then ytd_payout_cents else 0 end from public.respondents
        where id = requested_respondent_id)) + outstanding_cents + requested_amount_cents >= annual_cap_cents
    then raise check_violation; end if;

    insert into public.payouts (session_id, respondent_id, amount_cents, idempotency_key)
    values (requested_session_id, requested_respondent_id, requested_amount_cents, requested_key)
    returning id into reserved_id;
    return reserved_id;
end;
$$;
