create function public.read_gate1_researcher_transcripts(supplied_study_id uuid)
returns table (id uuid, respondent_number integer, student boolean, redacted_text text)
language sql stable security definer set search_path = ''
as $$
    with numbered_invites as (
        select invite.id, invite.respondent_id,
            row_number() over (order by invite.created_at, invite.id)::integer as respondent_number
        from public.invites as invite
        where invite.study_id = supplied_study_id and internal.researches_study(supplied_study_id)
    )
    select transcript.id, invite.respondent_number,
        case fact.value_json when 'true'::jsonb then true when 'false'::jsonb then false end,
        transcript.redacted_text
    from public.transcripts as transcript
    join public.answers as answer on answer.id = transcript.answer_id
    join public.sessions as session on session.id = answer.session_id
    join numbered_invites as invite on invite.id = session.invite_id
    left join public.profile_attributes as fact on fact.respondent_id = invite.respondent_id and fact.key = 'student'
    where transcript.study_id = supplied_study_id and internal.researches_transcript(transcript.id)
    order by invite.respondent_number, answer.sequence, transcript.id;
$$;

revoke all on function public.read_gate1_researcher_transcripts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_gate1_researcher_transcripts(uuid) to authenticated;
