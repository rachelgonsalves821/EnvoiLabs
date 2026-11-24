-- The provider observation is recorded by the trusted reconciliation service.
-- The transition itself rechecks the immutable quote and ledger under a study lock.
create function public.gate2_guide_digest(supplied_study_id uuid)
returns text language sql stable security definer set search_path = pg_catalog as $$
    select encode(sha256(convert_to(string_agg(
        question.position::text || ':' || char_length(question.text)::text || ':' ||
            question.text || ':' || question.max_probes::text,
        E'\n' order by question.position), 'UTF8')), 'hex')
    from public.guide_questions as question where question.study_id = supplied_study_id;
$$;
revoke all on function public.gate2_guide_digest(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.gate2_guide_digest(uuid) to service_role;

-- Guide and brief edits serialize with the paid transition on the same study row.
create function internal.lock_gate2_study_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
    if tg_op = 'UPDATE' and new.study_id is distinct from old.study_id then
        raise check_violation;
    end if;
    target_id := case when tg_op = 'DELETE' then old.study_id else new.study_id end;
    perform 1 from public.studies where id = target_id for update;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function internal.lock_gate2_study_content()
    from public, anon, authenticated, service_role;
create trigger lock_gate2_guide_study before insert or update or delete on public.guide_questions
    for each row execute function internal.lock_gate2_study_content();
create trigger lock_gate2_brief_study before insert or update or delete on public.brief_versions
    for each row execute function internal.lock_gate2_study_content();

-- Freezing a quote uses the same lock and the same canonical guide digest that
-- launch later recomputes. The service cannot supply an arbitrary digest.
create function public.freeze_gate2_quote(
    supplied_study_id uuid, supplied_brief_version integer,
    supplied_config_id uuid, supplied_config_version integer,
    supplied_line_items jsonb, supplied_total_cents integer,
    supplied_incentive_cents integer, supplied_feasibility jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    guide_hash text;
    frozen public.gate2_quote_snapshots%rowtype;
begin
    select * into target from public.studies where id = supplied_study_id for update;
    guide_hash := public.gate2_guide_digest(supplied_study_id);
    if target.id is null or target.state not in ('brief_ready', 'awaiting_payment')
        or guide_hash is null or supplied_brief_version is distinct from (
            select max(version) from public.brief_versions where study_id = target.id)
        or not exists (select 1 from public.pricing_configs as config
            join public.organizations as org on org.id = target.organization_id
            where config.id = supplied_config_id and config.version = supplied_config_version
                and (org.pricing_override_id = config.id
                    or (org.pricing_override_id is null and config.active)))
    then raise check_violation; end if;
    insert into public.gate2_quote_snapshots (study_id, brief_version, guide_digest,
        pricing_config_id, pricing_config_version, line_items_json, total_cents,
        incentive_cents_per_complete, feasibility_json)
    values (target.id, supplied_brief_version, guide_hash, supplied_config_id,
        supplied_config_version, supplied_line_items, supplied_total_cents,
        supplied_incentive_cents, supplied_feasibility)
    on conflict (study_id, brief_version, guide_digest, pricing_config_version) do nothing;
    select * into frozen from public.gate2_quote_snapshots
    where study_id = target.id and brief_version = supplied_brief_version
        and guide_digest = guide_hash and pricing_config_version = supplied_config_version;
    if frozen.pricing_config_id is distinct from supplied_config_id
        or frozen.line_items_json is distinct from supplied_line_items
        or frozen.total_cents is distinct from supplied_total_cents
        or frozen.incentive_cents_per_complete is distinct from supplied_incentive_cents
        or frozen.feasibility_json is distinct from supplied_feasibility
    then raise unique_violation; end if;
    return frozen.id;
end;
$$;
revoke all on function public.freeze_gate2_quote(uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.freeze_gate2_quote(uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    to service_role;
revoke insert on public.gate2_quote_snapshots from service_role;

create function public.launch_gate2_paid_study(
    supplied_study_id uuid, supplied_quote_id uuid, supplied_provider_event_id text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    paid public.gate2_payment_events%rowtype;
begin
    select * into target from public.studies where id = supplied_study_id for update;
    if not found then return false; end if;
    if target.state = 'fielding' then
        return exists (select 1 from public.audit_log as entry
            where entry.entity = 'study' and entry.entity_id = target.id
                and entry.from_state = 'awaiting_payment' and entry.to_state = 'fielding'
                and entry.meta ->> 'quoteId' = supplied_quote_id::text
                and entry.meta ->> 'providerEventId' = supplied_provider_event_id);
    end if;
    if target.state <> 'awaiting_payment' then return false; end if;
    select * into frozen from public.gate2_quote_snapshots
    where id = supplied_quote_id and study_id = target.id;
    if not found or frozen.guide_digest is distinct from public.gate2_guide_digest(target.id)
        or frozen.brief_version is distinct from (
        select max(version) from public.brief_versions where study_id = target.id
    ) then return false; end if;
    select * into paid from public.gate2_payment_events
    where provider_event_id = supplied_provider_event_id and quote_id = frozen.id
        and study_id = target.id and event_kind = 'paid'
        and amount_cents = frozen.total_cents and currency = frozen.currency;
    if not found or not exists (select 1 from public.gate2_payment_events as created
        where created.quote_id = frozen.id and created.study_id = target.id
            and created.provider_checkout_id = paid.provider_checkout_id
            and created.event_kind = 'checkout_created'
            and created.amount_cents = frozen.total_cents and created.currency = frozen.currency)
        or exists (select 1 from public.gate2_payment_events as later
            where later.quote_id = frozen.id and later.study_id = target.id
                and later.provider_checkout_id = paid.provider_checkout_id
                and later.event_kind in ('refunded', 'failed'))
    then return false; end if;
    update public.studies set state = 'fielding', updated_at = clock_timestamp()
    where id = target.id;
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor, meta)
    values ('study', target.id, 'awaiting_payment', 'fielding', 'platform',
        jsonb_build_object('quoteId', frozen.id, 'pricingConfigVersion',
            frozen.pricing_config_version, 'providerEventId', paid.provider_event_id));
    return true;
end;
$$;
revoke all on function public.launch_gate2_paid_study(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.launch_gate2_paid_study(uuid, uuid, text) to service_role;
