-- One respondent lock serializes all session payout reservations, including
-- different sessions and duplicate requests. Provider delivery is separate.
create table public.gate2_payout_events (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null references public.payouts (id),
    provider_event_id text not null unique check (btrim(provider_event_id) <> ''),
    provider_order_id text not null check (btrim(provider_order_id) <> ''),
    event_kind text not null check (event_kind in ('ordered', 'delivered', 'failed')),
    amount_cents integer not null check (amount_cents > 0),
    provider_observed_at timestamptz not null,
    created_at timestamptz not null default now()
);
alter table public.gate2_payout_events enable row level security;
revoke all on public.gate2_payout_events from public, anon, authenticated, service_role;
grant select, insert on public.gate2_payout_events to service_role;
create trigger immutable_gate2_payout_event before update or delete on public.gate2_payout_events
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.reserve_gate2_session_payout(
    requested_session_id uuid, requested_respondent_id uuid,
    requested_amount_cents integer, annual_cap_cents integer,
    requested_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    existing public.payouts%rowtype;
    approved_reward integer;
    delivered_cents bigint;
    outstanding_cents bigint;
    year_start timestamptz;
    reserved_id uuid;
begin
    if requested_amount_cents is null or requested_amount_cents <= 0
        or annual_cap_cents is null or annual_cap_cents <= 0 or annual_cap_cents > 200000
        or requested_key is distinct from 'payout:' || requested_session_id::text
    then raise check_violation; end if;

    perform 1 from public.respondents where id = requested_respondent_id and status = 'active' for update;
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
        and offer.respondent_id = requested_respondent_id;
    if approved_reward is distinct from requested_amount_cents then raise check_violation; end if;

    year_start := make_timestamptz(extract(year from now() at time zone 'UTC')::integer,
        1, 1, 0, 0, 0, 'UTC');
    select coalesce(sum(amount_cents) filter (where state = 'delivered'), 0),
        coalesce(sum(amount_cents) filter (where state in ('pending', 'ordered')), 0)
        into delivered_cents, outstanding_cents
    from public.payouts where respondent_id = requested_respondent_id
        and created_at >= year_start and created_at < year_start + interval '1 year';
    if greatest(delivered_cents, (select ytd_payout_cents from public.respondents
        where id = requested_respondent_id)) + outstanding_cents + requested_amount_cents >= annual_cap_cents
    then raise check_violation; end if;

    insert into public.payouts (session_id, respondent_id, amount_cents, idempotency_key)
    values (requested_session_id, requested_respondent_id, requested_amount_cents, requested_key)
    returning id into reserved_id;
    return reserved_id;
end;
$$;
revoke all on function public.reserve_gate2_session_payout(uuid, uuid, integer, integer, text)
    from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_session_payout(uuid, uuid, integer, integer, text)
    to service_role;

-- The application must use the locking reservation function rather than a
-- direct insert. Existing preview payouts are readable but have no Gate 2 writer.
revoke insert on public.payouts from service_role;
