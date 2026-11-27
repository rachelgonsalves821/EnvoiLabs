-- The production dispatcher obtains the upload time from the immutable
-- opportunity receipt. It cannot invent or replace a browser timestamp.
create function public.begin_gate3_probe_turn_with_clock(
    supplied_answer_id uuid, supplied_auth_user_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
    answer public.answers%rowtype;
    opportunity internal.gate3_probe_opportunities%rowtype;
begin
    select * into answer from public.answers where id = supplied_answer_id;
    if not found then return null; end if;
    perform 1 from public.sessions where id = answer.session_id for update;
    if not found then return null; end if;
    select * into opportunity from internal.gate3_probe_opportunities
    where answer_id = supplied_answer_id for update;
    if not found or opportunity.browser_clock_origin_id is null
        or opportunity.browser_upload_receipt_ms is null
        or not internal.gate3_probe_original_consent_current(supplied_answer_id)
    then return null; end if;
    return public.begin_gate3_probe_turn(
        supplied_answer_id, supplied_auth_user_id,
        opportunity.browser_upload_receipt_ms);
end;
$$;
revoke all on function public.begin_gate3_probe_turn_with_clock(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.begin_gate3_probe_turn_with_clock(uuid, uuid)
    to service_role;
