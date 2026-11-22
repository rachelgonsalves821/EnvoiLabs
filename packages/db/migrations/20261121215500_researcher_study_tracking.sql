create function internal.gate1_study_counts(supplied_study_id uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
    select jsonb_build_object(
        'invited', count(*) filter (where invite.state in ('invited', 'accepted', 'declined', 'expired')),
        'accepted', count(*) filter (where invite.state = 'accepted'),
        'completed', count(*) filter (where session.state in ('submitted', 'quality_hold', 'approved', 'paid')),
        'removed', count(*) filter (where session.state = 'removed')
    )
    from public.invites as invite
    left join public.sessions as session on session.invite_id = invite.id
    where invite.study_id = supplied_study_id and internal.researches_study(supplied_study_id)
    having internal.researches_study(supplied_study_id);
$$;

revoke all on function internal.gate1_study_counts(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.gate1_study_counts(uuid) to authenticated;

create function public.get_gate1_study_tracking(supplied_study_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
    select jsonb_build_object(
        'studyId', study.id,
        'title', study.title,
        'targetCompletes', study.target_completes,
        'state', study.state,
        'projectedFinish', null
    ) || internal.gate1_study_counts(study.id)
    from research.studies as study
    where study.id = supplied_study_id;
$$;

revoke all on function public.get_gate1_study_tracking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_gate1_study_tracking(uuid) to authenticated;
