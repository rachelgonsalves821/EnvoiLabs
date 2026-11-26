-- A reviewed marketplace result cannot be reversed by writing sessions.state.
-- The approved -> paid bookkeeping transition preserves the approved slot.
create or replace function internal.gate2_guard_quality_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    reviewed_decision text;
begin
    if new.state is not distinct from old.state or not exists (
        select 1 from public.gate2_quote_snapshots as quote
        where quote.study_id = old.study_id
            and quote.pricing_config_version >= 101
    ) then return new; end if;

    select score.decision into reviewed_decision
    from public.quality_scores as score where score.session_id = old.id;

    if old.state in ('approved', 'removed', 'paid') then
        if old.state = 'approved' and new.state = 'paid'
            and reviewed_decision = 'approve'
        then return new; end if;
        raise check_violation;
    end if;

    if new.state in ('approved', 'paid')
        and reviewed_decision is distinct from 'approve'
    then raise check_violation; end if;
    if new.state = 'removed'
        and reviewed_decision is distinct from 'remove'
    then raise check_violation; end if;
    -- A paid session must pass through the approved state first.
    if new.state = 'paid' then raise check_violation; end if;
    return new;
end;
$$;
