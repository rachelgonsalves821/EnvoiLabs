-- A browser render failure is a terminal private receipt, serialized with
-- shown/timeout/superseded by the same session and turn locks.
alter table internal.gate3_probe_turns drop constraint gate3_probe_turns_render_outcome_check;
alter table internal.gate3_probe_turns add constraint gate3_probe_turns_render_outcome_check
    check (render_outcome in ('shown', 'error', 'timeout', 'superseded'));

create function public.record_gate3_probe_render_error(
    supplied_session_id uuid, supplied_turn_id uuid, supplied_probe_id uuid,
    supplied_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare turn internal.gate3_probe_turns%rowtype;
declare stamped_at timestamptz;
begin
    perform 1 from public.sessions where id = supplied_session_id for update;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    select * into turn from internal.gate3_probe_turns
    where id = supplied_turn_id and session_id = supplied_session_id for update;
    if not found or turn.probe_id is distinct from supplied_probe_id
        or turn.decision_json ->> 'action' is distinct from 'probe'
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return jsonb_build_object('status', 'stale'); end if;
    if turn.render_outcome is not null then
        return jsonb_build_object('status', 'resolved',
            'outcome', turn.render_outcome, 'turnId', turn.id);
    end if;
    if turn.decided_at + interval '30 seconds' <= clock_timestamp()
    then return jsonb_build_object('status', 'stale'); end if;
    stamped_at := clock_timestamp();
    update internal.gate3_probe_turns set render_outcome = 'error',
        render_resolved_at = stamped_at where id = turn.id;
    return jsonb_build_object('status', 'resolved',
        'outcome', 'error', 'turnId', turn.id);
end;
$$;
revoke all on function public.record_gate3_probe_render_error(uuid,uuid,uuid,uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_probe_render_error(uuid,uuid,uuid,uuid)
    to service_role;
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
        or turn.render_outcome in ('error', 'timeout', 'superseded')
        or not internal.gate3_probe_current(turn.id, supplied_auth_user_id)
    then return 'stale'; end if;
    if turn.shown_at is not null then return 'recorded'; end if;
    if turn.decided_at + interval '30 seconds' <= clock_timestamp()
    then return 'stale'; end if;
    if supplied_browser_rendered_ms > turn.browser_upload_confirmed_ms + 6000
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


create or replace function public.read_gate3_respondent_probe(
    supplied_session_id uuid, supplied_auth_user_id uuid
) returns jsonb language sql volatile security definer set search_path = '' as $$
    select jsonb_build_object('turnId', turn.id, 'probeId', probe.id,
        'text', probe.text)
    from internal.gate3_probe_turns as turn
    join public.probes as probe on probe.id = turn.probe_id
    where turn.session_id = supplied_session_id
        and turn.decision_json ->> 'action' = 'probe'
        and (turn.decision_deadline_at > clock_timestamp()
            or turn.shown_at is not null)
        and (turn.render_outcome is null or turn.render_outcome = 'shown')
        and internal.gate3_probe_current(turn.id, supplied_auth_user_id)
        and not exists (select 1 from public.answers as answer
            where answer.probe_id = probe.id)
    order by probe.decided_at desc, probe.id desc limit 1;
$$;

