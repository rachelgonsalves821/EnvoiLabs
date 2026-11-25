-- Push is opt-in and disabled until approved copy, registration and sender
-- exist. Queueing never sends a notification or exposes a resume token.
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in (
    'recording', 'transcription_vendor', 'retention', 'researcher_access',
    'voice_clip_sharing', 'push_notifications'));

create table internal.gate2_nudge_snoozes (
    invite_id uuid primary key references public.invites (id),
    until_at timestamptz not null,
    updated_at timestamptz not null default clock_timestamp()
);
create table internal.gate2_nudge_outbox (
    id uuid primary key default gen_random_uuid(),
    invite_id uuid not null references public.invites (id),
    session_id uuid not null references public.sessions (id),
    kind text not null check (kind in ('halfway', 'two_hours_left')),
    idempotency_key text not null unique,
    state text not null default 'queued' check (state = 'queued'),
    created_at timestamptz not null default clock_timestamp(),
    unique (invite_id, kind)
);
alter table internal.gate2_nudge_snoozes enable row level security;
alter table internal.gate2_nudge_outbox enable row level security;
revoke all on internal.gate2_nudge_snoozes,
    internal.gate2_nudge_outbox from public, anon, authenticated, service_role;

create function public.snooze_gate2_nudge(supplied_invite_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
    offer public.invites%rowtype;
    interview public.sessions%rowtype;
    until_at timestamptz;
begin
    -- Lock session before offer, matching queue_gate2_nudge's lock order.
    select * into interview from public.sessions as candidate
    where candidate.invite_id = supplied_invite_id
        and candidate.state = 'in_progress' for update;
    if not found then return null; end if;
    select * into offer from public.invites as candidate
    where candidate.id = supplied_invite_id and candidate.state = 'accepted'
        and candidate.expires_at > clock_timestamp()
        and exists (select 1 from public.respondents as owner
            where owner.id = candidate.respondent_id
                and owner.auth_user_id = auth.uid() and owner.status = 'active')
    for update;
    if not found then return null; end if;
    until_at := least(offer.expires_at, clock_timestamp() + interval '3 hours');
    insert into internal.gate2_nudge_snoozes (invite_id, until_at)
    values (offer.id, until_at)
    on conflict (invite_id) do update set until_at = excluded.until_at,
        updated_at = clock_timestamp();
    return until_at;
end;
$$;
revoke all on function public.snooze_gate2_nudge(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.snooze_gate2_nudge(uuid) to authenticated;

create function public.list_gate2_nudge_candidates()
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'inviteId', offer.id, 'sessionId', interview.id,
        'state', interview.state, 'expiresAt', offer.expires_at,
        'coreQuestionCount', question_count.total,
        'answeredCoreCount', answers.answered,
        'lastActivityAt', greatest(interview.started_at,
            coalesce(answers.last_activity, interview.started_at)),
        'snoozedUntil', snooze.until_at,
        'sentKinds', coalesce(queued.kinds, '[]'::jsonb))
        order by offer.expires_at, offer.id), '[]'::jsonb)
    from public.invites as offer
    join public.sessions as interview on interview.invite_id = offer.id
    join public.studies as study on study.id = offer.study_id
    join public.respondents as respondent on respondent.id = offer.respondent_id
    cross join lateral (select count(*)::integer as total
        from public.guide_questions as question
        where question.study_id = study.id) as question_count
    cross join lateral (select (count(distinct answer.guide_question_id)
            filter (where answer.probe_id is null))::integer as answered,
            max(answer.created_at) as last_activity
        from public.answers as answer
        where answer.session_id = interview.id) as answers
    left join internal.gate2_nudge_snoozes as snooze on snooze.invite_id = offer.id
    left join lateral (select jsonb_agg(outbox.kind) as kinds
        from internal.gate2_nudge_outbox as outbox
        where outbox.invite_id = offer.id) as queued on true
    where study.state = 'fielding' and offer.state = 'accepted'
        and offer.expires_at > clock_timestamp()
        and interview.state = 'in_progress'
        and respondent.status = 'active'
        and question_count.total > 0
        and internal.gate1_consent(respondent.id, study.id, 'push_notifications')
        and exists (select 1 from public.push_subscriptions as subscription
            where subscription.respondent_id = respondent.id)
        and exists (select 1 from public.gate2_quote_snapshots as quote
            join public.gate2_payment_events as paid
                on paid.quote_id = quote.id and paid.event_kind = 'paid'
            where quote.study_id = study.id and quote.pricing_config_version >= 101);
$$;
revoke all on function public.list_gate2_nudge_candidates()
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_nudge_candidates() to service_role;

create function public.queue_gate2_nudge(
    supplied_invite_id uuid, supplied_session_id uuid,
    supplied_kind text, supplied_key text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    interview public.sessions%rowtype;
    offer public.invites%rowtype;
    target public.studies%rowtype;
    current_at timestamptz;
    core_count integer;
    answered_count integer;
    last_activity timestamptz;
begin
    if supplied_kind not in ('halfway', 'two_hours_left')
        or supplied_key is distinct from
            'gate2-nudge:' || supplied_invite_id::text || ':' || supplied_kind
    then return false; end if;
    select * into interview from public.sessions
        where id = supplied_session_id and invite_id = supplied_invite_id
        for update;
    if not found or interview.state <> 'in_progress' then return false; end if;
    select * into offer from public.invites where id = interview.invite_id for update;
    current_at := clock_timestamp();
    select * into target from public.studies where id = interview.study_id;
    if offer.state <> 'accepted' or offer.expires_at <= current_at
        or target.state <> 'fielding'
        or exists (select 1 from internal.gate2_nudge_snoozes
            where invite_id = offer.id and until_at > current_at)
        or not exists (select 1 from public.respondents as respondent
            where respondent.id = offer.respondent_id and respondent.status = 'active'
                and internal.gate1_consent(respondent.id, target.id,
                    'push_notifications')
                and exists (select 1 from public.push_subscriptions as subscription
                    where subscription.respondent_id = respondent.id))
        or not exists (select 1 from public.gate2_quote_snapshots as quote
            join public.gate2_payment_events as paid
                on paid.quote_id = quote.id and paid.event_kind = 'paid'
            where quote.study_id = target.id and quote.pricing_config_version >= 101)
    then return false; end if;
    select count(*)::integer into core_count from public.guide_questions
        where study_id = target.id;
    select (count(distinct answer.guide_question_id)
            filter (where answer.probe_id is null))::integer,
        max(answer.created_at)
        into answered_count, last_activity
    from public.answers as answer where answer.session_id = interview.id;
    last_activity := greatest(interview.started_at,
        coalesce(last_activity, interview.started_at));
    if core_count < 1 or answered_count >= core_count
        or (supplied_kind = 'halfway' and not (
            answered_count >= (core_count + 1) / 2
            and last_activity <= current_at - interval '2 hours'
            and current_at < offer.expires_at - interval '2 hours'))
        or (supplied_kind = 'two_hours_left' and not (
            current_at >= offer.expires_at - interval '2 hours'))
    then return false; end if;
    insert into internal.gate2_nudge_outbox (invite_id, session_id,
        kind, idempotency_key)
    values (offer.id, interview.id, supplied_kind, supplied_key)
    on conflict (invite_id, kind) do nothing;
    return found;
end;
$$;
revoke all on function public.queue_gate2_nudge(uuid, uuid, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.queue_gate2_nudge(uuid, uuid, text, text)
    to service_role;
