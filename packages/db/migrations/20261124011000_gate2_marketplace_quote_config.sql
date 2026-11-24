-- Gate 1 preview keeps its old active config. Marketplace quotes select a
-- separate, versioned policy and cannot reinterpret an already frozen quote.
alter table public.pricing_configs add column marketplace_active boolean not null default false;
create unique index pricing_configs_one_marketplace_active
    on public.pricing_configs (marketplace_active) where marketplace_active;
insert into public.pricing_configs (version, params_json, active, marketplace_active)
values (101, '{"unitPriceCents":200,"incentivePerQuestionCents":100}', false, true)
on conflict (version) do nothing;

-- Extend only the config-selection predicate of the existing frozen-row
-- writer. Its guide, brief, conflict and amount checks remain authoritative.
create or replace function internal.freeze_gate2_quote_unchecked(
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
                    or (org.pricing_override_id is null and (config.active
                        or (config.marketplace_active and target.target_completes >= 10
                            and config.params_json =
                                '{"unitPriceCents":200,"incentivePerQuestionCents":100}'::jsonb)))))
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

create function public.freeze_gate2_marketplace_quote(
    supplied_study_id uuid, supplied_brief_version integer,
    supplied_config_id uuid, supplied_config_version integer,
    supplied_line_items jsonb, supplied_total_cents integer,
    supplied_incentive_cents integer, supplied_feasibility jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    config public.pricing_configs%rowtype;
begin
    select * into target from public.studies where id = supplied_study_id for update;
    select * into config from public.pricing_configs
        where id = supplied_config_id and version = supplied_config_version for share;
    if target.id is null or target.target_completes < 10 or config.id is null
        or not config.marketplace_active or config.params_json is distinct from
            '{"unitPriceCents":200,"incentivePerQuestionCents":100}'::jsonb
    then raise check_violation; end if;
    return public.freeze_gate2_quote(supplied_study_id, supplied_brief_version,
        supplied_config_id, supplied_config_version, supplied_line_items,
        supplied_total_cents, supplied_incentive_cents, supplied_feasibility);
end;
$$;
revoke all on function public.freeze_gate2_marketplace_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.freeze_gate2_marketplace_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb) to service_role;
