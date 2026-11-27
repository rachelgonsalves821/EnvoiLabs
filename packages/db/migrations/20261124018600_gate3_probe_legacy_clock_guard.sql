-- The older three-argument begin RPC remains for synthetic legacy turns.
-- Once an answer has a captured page-clock receipt, even that entrypoint
-- must not create a turn with a caller-supplied different upload time.
create function internal.gate3_match_captured_upload_on_turn_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    opportunity internal.gate3_probe_opportunities%rowtype;
begin
    select * into opportunity from internal.gate3_probe_opportunities
    where answer_id = new.answer_id;
    if opportunity.browser_clock_origin_id is not null
        and new.browser_upload_confirmed_ms is distinct from
            opportunity.browser_upload_receipt_ms
    then return null; end if;
    return new;
end;
$$;
create trigger gate3_match_captured_upload_on_turn_insert
before insert on internal.gate3_probe_turns for each row
execute function internal.gate3_match_captured_upload_on_turn_insert();
revoke all on function internal.gate3_match_captured_upload_on_turn_insert()
    from public, anon, authenticated, service_role;
