-- A five-profile vesting is earned once. This freezes a TEST Visa payout only
-- when the synthetic catalog can issue the exact $5 denomination.
create unique index gate2_unique_payout_bonus_source
    on public.payouts (bonus_ref) where bonus_ref is not null;
alter table internal.gate2_sandbox_visa_intents
    drop constraint sandbox_visa_one_payout_source,
    add column referral_vesting_id uuid unique
        references public.gate2_referral_vestings (id),
    add constraint sandbox_visa_one_payout_source check (
        (session_id is not null)::integer +
        (batch_id is not null)::integer +
        (referral_vesting_id is not null)::integer = 1);

create function public.reserve_gate2_sandbox_visa_referral_bonus(
    requested_vesting_id uuid, annual_cap_cents integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    vested public.gate2_referral_vestings%rowtype;
    owner public.respondents%rowtype;
    route internal.gate2_sandbox_visa_routes%rowtype;
    product internal.gate2_sandbox_visa_products%rowtype;
    saved public.payouts%rowtype;
    intent internal.gate2_sandbox_visa_intents%rowtype;
    delivered_cents bigint;
    outstanding_cents bigint;
    current_year integer;
    stable_key text;
begin
    if requested_vesting_id is null or annual_cap_cents is null
        or annual_cap_cents <= 500 or annual_cap_cents > 200000
    then raise check_violation; end if;
    select * into vested from public.gate2_referral_vestings
        where id = requested_vesting_id;
    if not found then raise check_violation; end if;
    select * into owner from public.respondents
        where id = vested.referrer_id and status = 'active' for update;
    if not found or vested.bonus_cents <> 500
        or vested.verified_profile_count <> 5
        or vested.idempotency_key is distinct from
            'gate2-referral-bonus:' || owner.id::text
        or (select count(distinct verification.referee_id)
            from public.gate2_referral_profile_verifications as verification
            where verification.referrer_id = owner.id) < 5
    then raise check_violation; end if;
    stable_key := 'gate2-referral-visa:' || vested.id::text;
    select * into saved from public.payouts
        where bonus_ref = vested.id for update;
    if found then
        select * into intent from internal.gate2_sandbox_visa_intents
            where payout_id = saved.id;
        if not found or saved.respondent_id is distinct from owner.id
            or saved.amount_cents <> 500
            or saved.idempotency_key is distinct from stable_key
            or intent.referral_vesting_id is distinct from vested.id
            or intent.respondent_id is distinct from owner.id
            or intent.amount_cents <> 500
        then raise check_violation; end if;
        return jsonb_build_object('status', 'reserved',
            'payoutId', saved.id, 'vestingId', vested.id,
            'respondentId', owner.id, 'recipientId', saved.id,
            'productId', intent.product_id, 'amountCents', 500,
            'payoutState', saved.state,
            'providerOrderId', saved.tremendous_order_id);
    end if;
    select * into route from internal.gate2_sandbox_visa_routes
        where respondent_id = owner.id;
    if not found then raise check_violation using message = 'sandbox recipient absent'; end if;
    select * into product from internal.gate2_sandbox_visa_products
        where country = route.country;
    if not found then raise check_violation using message = 'sandbox Visa SKU absent'; end if;
    if 500 < product.minimum_cents or 500 > product.maximum_cents then
        return jsonb_build_object('status', 'below_minimum',
            'bonusCents', 500, 'minimumCents', product.minimum_cents);
    end if;
    current_year := extract(year from now() at time zone 'UTC')::integer;
    select coalesce(sum(amount_cents) filter (where state = 'delivered'
        and created_at >= make_timestamptz(current_year, 1, 1, 0, 0, 0, 'UTC')
        and created_at < make_timestamptz(current_year + 1, 1, 1, 0, 0, 0, 'UTC')), 0),
        coalesce(sum(amount_cents) filter (where state in ('pending', 'ordered')), 0)
        into delivered_cents, outstanding_cents
    from public.payouts where respondent_id = owner.id;
    if greatest(delivered_cents, case when owner.ytd_payout_year = current_year
        then owner.ytd_payout_cents else 0 end)
        + outstanding_cents + 500 >= annual_cap_cents
    then raise check_violation using message = 'annual payout cap'; end if;
    insert into public.payouts (bonus_ref, respondent_id,
        amount_cents, idempotency_key)
    values (vested.id, owner.id, 500, stable_key) returning * into saved;
    insert into internal.gate2_sandbox_visa_intents
        (payout_id, referral_vesting_id, respondent_id, amount_cents,
        recipient_name, recipient_email, country, product_id,
        verification_receipt, catalog_receipt)
    values (saved.id, vested.id, owner.id, 500, route.recipient_name,
        route.recipient_email, route.country, product.product_id,
        route.verification_receipt, product.catalog_receipt);
    return jsonb_build_object('status', 'reserved',
        'payoutId', saved.id, 'vestingId', vested.id,
        'respondentId', owner.id, 'recipientId', saved.id,
        'productId', product.product_id, 'amountCents', 500,
        'payoutState', 'pending', 'providerOrderId', null);
end;
$$;
revoke all on function public.reserve_gate2_sandbox_visa_referral_bonus(
    uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.reserve_gate2_sandbox_visa_referral_bonus(
    uuid, integer) to service_role;
