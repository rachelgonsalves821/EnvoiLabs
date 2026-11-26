-- Disposable Auth stack only. No fixture function is part of a migration.
create function public.test_gate2_audio_history_fixture(supplied_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    owner_id uuid := gen_random_uuid();
    study_id uuid := gen_random_uuid();
    question_id uuid := gen_random_uuid();
    session_id uuid := gen_random_uuid();
    live_id uuid := gen_random_uuid();
    expired_id uuid := gen_random_uuid();
    org_id uuid := gen_random_uuid();
    offer_id uuid;
begin
    if not exists (select 1 from auth.users where id = supplied_user_id
        and email like 'gate2-audio-history-%@example.test') then
        raise insufficient_privilege;
    end if;
    insert into public.respondents (id, auth_user_id, age_attested_at)
    values (owner_id, supplied_user_id, clock_timestamp());
    insert into public.organizations (id, name)
    values (org_id, 'Synthetic audio history fixture');
    insert into public.studies (id, organization_id, title, state,
        target_completes, length_minutes)
    values (study_id, org_id, 'Synthetic audio history', 'fielding', 10, 10);
    insert into public.guide_questions (id, study_id, position, text)
    values (question_id, study_id, 1, 'Describe a synthetic choice');
    insert into public.consents (respondent_id, study_id, purpose, granted,
        text_version)
    select owner_id, study_id, purpose, true, 'synthetic-audio-history'
    from (values ('retention'), ('recording'), ('transcription_vendor'))
        as purposes(purpose);
    insert into public.invites (id, study_id, respondent_id, state,
        reward_cents, expires_at)
    values (gen_random_uuid(), study_id, owner_id, 'accepted', 100,
        clock_timestamp() + interval '1 hour')
    returning id into offer_id;
    insert into public.sessions (id, invite_id, study_id, state)
    values (session_id, offer_id, study_id, 'in_progress');
    insert into internal.gate1_audio_uploads (id, session_id, question_id,
        bytes, mime, expires_at)
    values (live_id, session_id, question_id, 4, 'audio/webm',
        clock_timestamp() + interval '1 hour'),
        (expired_id, session_id, question_id, 4, 'audio/webm',
        clock_timestamp() - interval '1 minute');
    return jsonb_build_object('ownerId', owner_id, 'sessionId', session_id,
        'questionId', question_id, 'liveId', live_id,
        'expiredId', expired_id);
end;
$$;
revoke all on function public.test_gate2_audio_history_fixture(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.test_gate2_audio_history_fixture(uuid)
    to service_role;
notify pgrst, 'reload schema';
