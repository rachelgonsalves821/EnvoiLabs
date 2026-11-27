-- A visible probe is a comparable browser timing sample only when its render
-- receipt comes from the same document clock as the captured upload receipt.
create function public.mark_gate3_probe_shown_with_clock(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid, supplied_browser_clock_origin_id uuid,
    supplied_browser_rendered_ms double precision
) returns text language plpgsql security definer set search_path = '' as $$
declare
    turn internal.gate3_probe_turns%rowtype;
    opportunity internal.gate3_probe_opportunities%rowtype;
    stamped_at timestamptz;
begin
    if supplied_browser_clock_origin_id is null
        or supplied_browser_rendered_ms is null or supplied_browser_rendered_ms < 0
        or supplied_browser_rendered_ms > 1000000000000
        or supplied_browser_rendered_ms in
            ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
    then return 'stale'; end if;
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return 'stale'; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or turn.render_outcome in ('error', 'timeout', 'superseded')
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        or not internal.gate3_probe_receipt_current(turn.id)
    then return 'stale'; end if;
    select * into opportunity from internal.gate3_probe_opportunities
    where answer_id = turn.answer_id;
    if not found or opportunity.browser_clock_origin_id is distinct from
            supplied_browser_clock_origin_id
        or opportunity.browser_upload_receipt_ms is null
        or opportunity.browser_upload_receipt_ms is distinct from
            turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if turn.decided_at + interval '30 seconds' <= clock_timestamp()
        or supplied_browser_rendered_ms > opportunity.browser_upload_receipt_ms + 6000
        or supplied_browser_rendered_ms < opportunity.browser_upload_receipt_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms,
        render_outcome = 'shown', render_resolved_at = stamped_at where id = turn.id;
    return 'recorded';
end;
$$;
revoke all on function public.mark_gate3_probe_shown_with_clock(
    uuid, uuid, uuid, uuid, uuid, double precision)
    from public, anon, authenticated, service_role;
grant execute on function public.mark_gate3_probe_shown_with_clock(
    uuid, uuid, uuid, uuid, uuid, double precision) to service_role;

-- Keep legacy synthetic turn tests available only for opportunities that
-- predate clock capture. A captured opportunity cannot be marked through the
-- five-argument path and bypass the same-origin proof.
create or replace function public.mark_gate3_probe_shown(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid, supplied_browser_rendered_ms double precision
) returns text language plpgsql security definer set search_path = '' as $$
declare
    turn internal.gate3_probe_turns%rowtype;
    stamped_at timestamptz;
begin
    if supplied_browser_rendered_ms is null or supplied_browser_rendered_ms < 0
        or supplied_browser_rendered_ms > 1000000000000
        or supplied_browser_rendered_ms in
            ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
    then return 'stale'; end if;
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return 'stale'; end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or turn.render_outcome in ('error', 'timeout', 'superseded')
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        or not internal.gate3_probe_receipt_current(turn.id)
        or exists (select 1 from internal.gate3_probe_opportunities as opportunity
            where opportunity.answer_id = turn.answer_id
                and opportunity.browser_clock_origin_id is not null)
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if turn.decided_at + interval '30 seconds' <= clock_timestamp()
        or supplied_browser_rendered_ms > turn.browser_upload_confirmed_ms + 6000
        or supplied_browser_rendered_ms < turn.browser_upload_confirmed_ms
    then return 'stale'; end if;
    stamped_at := clock_timestamp();
    update public.probes set shown_at = stamped_at where id = supplied_probe_id;
    update internal.gate3_probe_turns set shown_at = stamped_at,
        browser_rendered_ms = supplied_browser_rendered_ms,
        render_outcome = 'shown', render_resolved_at = stamped_at where id = turn.id;
    return 'recorded';
end;
$$;
