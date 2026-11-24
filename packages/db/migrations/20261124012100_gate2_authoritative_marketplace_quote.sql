-- A marketplace quote freezes a server-read feasibility receipt. Legacy V2/V3
-- rows remain immutable and readable; a new checkout requires the V4 shape.
-- Guard every insert path, including the older privileged quote writer.
create function internal.gate2_check_marketplace_quote_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    auth_id uuid;
    evidence jsonb;
    observed_at timestamptz;
begin
    if not exists (select 1 from public.pricing_configs
        where id = new.pricing_config_id and marketplace_active)
    then return new; end if;
    select researcher.auth_user_id into auth_id from public.studies as study
    join public.researchers as researcher
        on researcher.organization_id = study.organization_id
    where study.id = new.study_id order by researcher.id limit 1;
    if auth_id is null or jsonb_typeof(new.feasibility_json -> 'asOf') <> 'string'
    then raise check_violation; end if;
    observed_at := (new.feasibility_json ->> 'asOf')::timestamptz;
    if clock_timestamp() - observed_at not between interval '-2 seconds' and interval '30 seconds'
    then raise check_violation; end if;
    evidence := public.read_gate2_marketplace_feasibility(new.study_id, auth_id);
    if new.feasibility_json - 'asOf' is distinct from evidence - 'asOf'
    then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_check_marketplace_quote_evidence()
    from public, anon, authenticated, service_role;
create trigger gate2_authoritative_marketplace_evidence
    before insert on public.gate2_quote_snapshots
    for each row execute function internal.gate2_check_marketplace_quote_evidence();

drop function public.freeze_gate2_marketplace_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb);

create function public.freeze_gate2_marketplace_quote(
    supplied_study_id uuid, supplied_brief_version integer,
    supplied_config_id uuid, supplied_config_version integer,
    supplied_line_items jsonb, supplied_total_cents integer,
    supplied_incentive_cents integer, supplied_auth_user_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    config public.pricing_configs%rowtype;
    frozen public.gate2_quote_snapshots%rowtype;
    evidence jsonb;
begin
    select * into target from public.studies where id = supplied_study_id for update;
    select * into config from public.pricing_configs
        where id = supplied_config_id and version = supplied_config_version for share;
    if target.id is null or target.target_completes < 10 or config.id is null
        or not config.marketplace_active or config.params_json is distinct from
            '{"unitPriceCents":200,"incentivePerQuestionCents":100}'::jsonb
    then raise check_violation; end if;
    -- This restricted read checks that the supplied authenticated researcher
    -- belongs to the study organization and that the study can be quoted.
    evidence := public.read_gate2_marketplace_feasibility(
        supplied_study_id, supplied_auth_user_id);
    if evidence ->> 'studyId' is distinct from target.id::text
        or evidence -> 'fillHours' is distinct from 'null'::jsonb
    then raise check_violation; end if;
    -- An unchanged retry keeps its original evidence, amount and identity.
    -- Recomputing asOf on retry must never rewrite or split a frozen quote.
    select * into frozen from public.gate2_quote_snapshots
    where study_id = target.id and brief_version = supplied_brief_version
        and guide_digest = public.gate2_guide_digest(target.id)
        and pricing_config_version = supplied_config_version;
    if found then evidence := frozen.feasibility_json; end if;
    return public.freeze_gate2_quote(supplied_study_id, supplied_brief_version,
        supplied_config_id, supplied_config_version, supplied_line_items,
        supplied_total_cents, supplied_incentive_cents, evidence);
end;
$$;
revoke all on function public.freeze_gate2_marketplace_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.freeze_gate2_marketplace_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, uuid) to service_role;
