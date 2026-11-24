-- Keep the old frozen-row insert routine private. The public service entrypoint
-- now derives the billable count and cents from locked study/config rows.
revoke execute on function public.freeze_gate2_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb) from service_role;
alter function public.freeze_gate2_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb) set schema internal;
alter function internal.freeze_gate2_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    rename to freeze_gate2_quote_unchecked;
revoke all on function internal.freeze_gate2_quote_unchecked(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    from public, anon, authenticated, service_role;

create function public.freeze_gate2_quote(
    supplied_study_id uuid, supplied_brief_version integer,
    supplied_config_id uuid, supplied_config_version integer,
    supplied_line_items jsonb, supplied_total_cents integer,
    supplied_incentive_cents integer, supplied_feasibility jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    target public.studies%rowtype;
    config public.pricing_configs%rowtype;
    question_count integer;
    unit_cents integer;
    incentive_unit_cents integer;
    expected_total bigint;
    expected_incentive bigint;
begin
    select * into target from public.studies where id = supplied_study_id for update;
    select * into config from public.pricing_configs
        where id = supplied_config_id and version = supplied_config_version for share;
    select count(*) into question_count from public.guide_questions
        where study_id = supplied_study_id;
    if target.id is null or config.id is null or question_count not between 4 and 10
        or jsonb_typeof(config.params_json -> 'unitPriceCents') <> 'number'
        or jsonb_typeof(config.params_json -> 'incentivePerQuestionCents') <> 'number'
        or (config.params_json ->> 'unitPriceCents') !~ '^[0-9]+$'
        or (config.params_json ->> 'incentivePerQuestionCents') !~ '^[0-9]+$'
    then raise check_violation; end if;
    unit_cents := (config.params_json ->> 'unitPriceCents')::integer;
    incentive_unit_cents := (config.params_json ->> 'incentivePerQuestionCents')::integer;
    expected_total := question_count::bigint * target.target_completes * unit_cents;
    expected_incentive := question_count::bigint * incentive_unit_cents;
    if unit_cents <= 0 or incentive_unit_cents < 0
        or expected_total > 2147483647 or expected_incentive > 2147483647
        or supplied_total_cents is distinct from expected_total
        or supplied_incentive_cents is distinct from expected_incentive
        or supplied_line_items is distinct from jsonb_build_array(jsonb_build_object(
            'label', 'Core questions', 'coreQuestionCount', question_count,
            'respondentCount', target.target_completes,
            'unitPriceCents', unit_cents, 'amountCents', expected_total))
    then raise check_violation; end if;
    return internal.freeze_gate2_quote_unchecked(supplied_study_id,
        supplied_brief_version, supplied_config_id, supplied_config_version,
        supplied_line_items, supplied_total_cents, supplied_incentive_cents,
        supplied_feasibility);
end;
$$;
revoke all on function public.freeze_gate2_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.freeze_gate2_quote(
    uuid, integer, uuid, integer, jsonb, integer, integer, jsonb) to service_role;

create function internal.prevent_pricing_config_rewrite_after_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if exists (select 1 from public.gate2_quote_snapshots
        where pricing_config_id = old.id and pricing_config_version = old.version)
    then raise check_violation; end if;
    return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function internal.prevent_pricing_config_rewrite_after_quote()
    from public, anon, authenticated, service_role;
create trigger keep_gate2_used_pricing_config before update or delete on public.pricing_configs
    for each row execute function internal.prevent_pricing_config_rewrite_after_quote();
