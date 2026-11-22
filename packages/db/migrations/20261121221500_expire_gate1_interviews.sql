create function public.expire_gate1_interviews(supplied_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
    expired_invites integer;
    abandoned_sessions integer;
    cohort_label constant jsonb := '["gate1_food"]'::jsonb;
begin
    if supplied_cutoff is null then raise invalid_parameter_value; end if;

    with expired as (
        update public.invites as invitation set state = 'expired'
        from public.studies as study
        where study.id = invitation.study_id and study.labels @> cohort_label
            and invitation.state = 'invited' and invitation.expires_at <= supplied_cutoff
        returning invitation.id
    )
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor, at)
    select 'invite', id, 'invited', 'expired', 'platform', supplied_cutoff from expired;
    get diagnostics expired_invites = row_count;

    with overdue as (
        select interview.id, interview.state
        from public.sessions as interview
        join public.invites as invitation on invitation.id = interview.invite_id
        join public.studies as study on study.id = invitation.study_id
        where study.labels @> cohort_label and invitation.state = 'accepted'
            and invitation.expires_at <= supplied_cutoff and interview.state in ('started', 'in_progress')
        for update of interview
    ), abandoned as (
        update public.sessions as interview set state = 'abandoned'
        from overdue where interview.id = overdue.id and interview.state = overdue.state
        returning interview.id, overdue.state as previous_state
    )
    insert into public.audit_log (entity, entity_id, from_state, to_state, actor, at)
    select 'session', id, previous_state, 'abandoned', 'platform', supplied_cutoff from abandoned;
    get diagnostics abandoned_sessions = row_count;

    return jsonb_build_object('expiredInvites', expired_invites, 'abandonedSessions', abandoned_sessions);
end;
$$;

revoke all on function public.expire_gate1_interviews(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.expire_gate1_interviews(timestamptz) to service_role;
