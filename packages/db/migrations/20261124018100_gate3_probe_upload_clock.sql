-- A browser clock is meaningful only within one page lifetime. Store the
-- upload acknowledgement against the exact answer, never infer it from a
-- server timestamp or from a later page's performance.now() value.
alter table internal.gate3_probe_opportunities
    add column browser_clock_origin_id uuid,
    add column browser_upload_confirmed_ms double precision,
    add column browser_upload_kind text,
    add column browser_clock_recorded_at timestamptz,
    add constraint gate3_probe_clock_pair check (
        (browser_clock_origin_id is null and browser_upload_confirmed_ms is null
            and browser_upload_kind is null and browser_clock_recorded_at is null)
        or (browser_clock_origin_id is not null and browser_upload_confirmed_ms is not null
            and browser_upload_kind in ('text_save_response', 'voice_object_put')
            and browser_clock_recorded_at is not null
            and browser_upload_confirmed_ms >= 0
            and browser_upload_confirmed_ms <= 1000000000000
            and browser_upload_confirmed_ms not in (
                'Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)));

create function internal.gate3_keep_probe_clock_receipt()
returns trigger language plpgsql set search_path = '' as $$
begin
    if old.browser_clock_origin_id is not null and
        (new.browser_clock_origin_id, new.browser_upload_confirmed_ms,
            new.browser_upload_kind, new.browser_clock_recorded_at) is distinct from
        (old.browser_clock_origin_id, old.browser_upload_confirmed_ms,
            old.browser_upload_kind, old.browser_clock_recorded_at)
    then raise check_violation using message = 'probe upload clock receipt is immutable'; end if;
    return new;
end;
$$;
create trigger gate3_keep_probe_clock_receipt
before update on internal.gate3_probe_opportunities
for each row execute function internal.gate3_keep_probe_clock_receipt();
revoke all on function internal.gate3_keep_probe_clock_receipt()
    from public, anon, authenticated, service_role;

-- A service caller supplies the actor from verified claims. The session lock
-- serializes competing receipts and answer replacement with the same order as
-- the probe decision transaction. No public table read is granted.
create function public.record_gate3_probe_upload_clock(
    supplied_answer_id uuid, supplied_auth_user_id uuid,
    supplied_browser_clock_origin_id uuid,
    supplied_browser_upload_confirmed_ms double precision,
    supplied_browser_upload_kind text
) returns text language plpgsql security definer set search_path = '' as $$
declare
    answer public.answers%rowtype;
    opportunity internal.gate3_probe_opportunities%rowtype;
begin
    if supplied_answer_id is null or supplied_auth_user_id is null
        or supplied_browser_clock_origin_id is null
        or supplied_browser_upload_confirmed_ms is null
        or supplied_browser_upload_confirmed_ms < 0
        or supplied_browser_upload_confirmed_ms > 1000000000000
        or supplied_browser_upload_confirmed_ms in (
            'Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
        or supplied_browser_upload_kind is null
        or supplied_browser_upload_kind not in
            ('text_save_response', 'voice_object_put')
    then return 'stale'; end if;
    select * into answer from public.answers where id = supplied_answer_id;
    if not found then return 'stale'; end if;
    perform 1 from public.sessions where id = answer.session_id for update;
    if not found or answer.created_at + interval '6 seconds' <= clock_timestamp()
        or (answer.kind = 'text' and supplied_browser_upload_kind <> 'text_save_response')
        or (answer.kind = 'voice' and supplied_browser_upload_kind <> 'voice_object_put')
        or answer.kind not in ('text', 'voice')
        or not internal.gate3_probe_original_consent_current(supplied_answer_id)
        or not internal.gate3_probe_current_for_answer(
            supplied_answer_id, supplied_auth_user_id)
    then return 'stale'; end if;
    select * into opportunity from internal.gate3_probe_opportunities
    where answer_id = supplied_answer_id for update;
    if not found then return 'stale'; end if;
    if opportunity.browser_clock_origin_id is not null then
        return case when opportunity.browser_clock_origin_id =
                supplied_browser_clock_origin_id
            and opportunity.browser_upload_confirmed_ms =
                supplied_browser_upload_confirmed_ms
            and opportunity.browser_upload_kind = supplied_browser_upload_kind
            then 'recorded' else 'stale' end;
    end if;
    update internal.gate3_probe_opportunities set
        browser_clock_origin_id = supplied_browser_clock_origin_id,
        browser_upload_confirmed_ms = supplied_browser_upload_confirmed_ms,
        browser_upload_kind = supplied_browser_upload_kind,
        browser_clock_recorded_at = clock_timestamp()
    where answer_id = supplied_answer_id;
    return 'recorded';
end;
$$;
revoke all on function public.record_gate3_probe_upload_clock(
    uuid, uuid, uuid, double precision, text)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_probe_upload_clock(
    uuid, uuid, uuid, double precision, text) to service_role;
