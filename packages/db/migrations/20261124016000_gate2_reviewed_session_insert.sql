-- A paid marketplace session begins before review. Direct insertion into a
-- terminal quality state would otherwise bypass the immutable decision ledger.
create function internal.gate2_guard_reviewed_session_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.state in ('approved', 'removed', 'paid') and exists (
        select 1 from public.gate2_quote_snapshots as quote
        where quote.study_id = new.study_id
            and quote.pricing_config_version >= 101
    ) then raise check_violation; end if;
    return new;
end;
$$;
revoke all on function internal.gate2_guard_reviewed_session_insert()
    from public, anon, authenticated, service_role;
create trigger gate2_guard_reviewed_session_insert
    before insert on public.sessions for each row
    execute function internal.gate2_guard_reviewed_session_insert();
