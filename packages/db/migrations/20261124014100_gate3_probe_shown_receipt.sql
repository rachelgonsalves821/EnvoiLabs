-- A prompt painted before the six-second browser window may report its shown
-- receipt after the RPC deadline. Keep the source, respondent and consent check.
create or replace function public.mark_gate3_probe_shown(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid, supplied_browser_rendered_ms double precision
) returns text language plpgsql security definer set search_path = '' as $$
declare turn internal.gate3_probe_turns%rowtype;
declare stamped_at timestamptz;
begin
    if supplied_browser_rendered_ms is null or supplied_browser_rendered_ms < 0
        or supplied_browser_rendered_ms > 1000000000000
        or supplied_browser_rendered_ms = 'Infinity'::float8
        or supplied_browser_rendered_ms = '-Infinity'::float8
        or supplied_browser_rendered_ms = 'NaN'::float8
    then return 'stale'; end if;
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return 'stale'; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if supplied_browser_rendered_ms > turn.browser_upload_confirmed_ms + 6000
        or supplied_browser_rendered_ms < turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms where id = turn.id;
    return 'recorded';
end;
$$;
