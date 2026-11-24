-- Reconcile a provider order under the same respondent lock used by reservation.
create function public.record_gate2_payout_observation(
    requested_payout_id uuid, requested_event_id text, requested_order_id text,
    requested_kind text, requested_amount_cents integer, requested_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.payouts%rowtype;
    prior public.gate2_payout_events%rowtype;
    respondent uuid;
begin
    select respondent_id into respondent from public.payouts where id = requested_payout_id;
    if respondent is null then return false; end if;
    perform 1 from public.respondents where id = respondent for update;
    select * into target from public.payouts where id = requested_payout_id for update;
    if target.respondent_id is distinct from respondent
        or requested_event_id is null or btrim(requested_event_id) = ''
        or requested_order_id is null or btrim(requested_order_id) = ''
        or requested_kind not in ('ordered', 'delivered', 'failed')
        or requested_amount_cents is distinct from target.amount_cents
        or requested_observed_at is null
        or (target.tremendous_order_id is not null
            and target.tremendous_order_id <> requested_order_id)
    then return false; end if;
    select * into prior from public.gate2_payout_events
    where provider_event_id = requested_event_id;
    if found then
        return prior.payout_id = target.id and prior.provider_order_id = requested_order_id
            and prior.event_kind = requested_kind and prior.amount_cents = requested_amount_cents
            and prior.provider_observed_at = requested_observed_at;
    end if;
    if target.state in ('delivered', 'failed')
        or (target.state = 'ordered' and requested_kind = 'ordered')
        or exists (select 1 from public.gate2_payout_events as earlier
            where earlier.payout_id = target.id
                and earlier.provider_observed_at > requested_observed_at)
    then return false; end if;
    insert into public.gate2_payout_events (payout_id, provider_event_id,
        provider_order_id, event_kind, amount_cents, provider_observed_at)
    values (target.id, requested_event_id, requested_order_id,
        requested_kind, requested_amount_cents, requested_observed_at);
    update public.payouts set state = requested_kind,
        tremendous_order_id = requested_order_id, updated_at = clock_timestamp()
    where id = target.id;
    if requested_kind = 'delivered' then
        update public.respondents set ytd_payout_cents = ytd_payout_cents + target.amount_cents
        where id = respondent;
    end if;
    return true;
end;
$$;
revoke all on function public.record_gate2_payout_observation(uuid, text, text, text, integer, timestamptz)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate2_payout_observation(uuid, text, text, text, integer, timestamptz)
    to service_role;
revoke update on public.payouts from service_role;
