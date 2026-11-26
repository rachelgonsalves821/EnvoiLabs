-- A private, one-statement study snapshot for frozen-slot and report-sample
-- provenance. A complete must have the immutable reviewed approval decision.
create function public.read_gate2_approved_complete_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid, supplied_auth_user_id uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
    with target as (
        select study.id as study_id, quote.id as quote_id,
            (quote.line_items_json -> 0 ->> 'respondentCount')::integer
                as purchased_slots
        from public.studies as study
        join public.gate2_quote_snapshots as quote
            on quote.study_id = study.id and quote.id = supplied_quote_id
        where study.id = supplied_study_id
            and quote.pricing_config_version >= 101
            and jsonb_array_length(quote.line_items_json) = 1
            and (quote.line_items_json -> 0 ->> 'respondentCount')
                ~ '^[0-9]+$'
            and (quote.line_items_json -> 0 ->> 'respondentCount')::integer
                = study.target_completes
            and exists (select 1 from public.researchers as researcher
                where researcher.organization_id = study.organization_id
                    and researcher.auth_user_id = supplied_auth_user_id)
            and exists (select 1 from public.gate2_payment_events as paid
                where paid.quote_id = quote.id and paid.event_kind = 'paid'
                    and paid.amount_cents = quote.total_cents
                    and paid.currency = quote.currency)
    ), completed as (
        select distinct on (offer.respondent_id) interview.id as session_id
        from target
        join public.sessions as interview
            on interview.study_id = target.study_id
        join public.invites as offer on offer.id = interview.invite_id
            and offer.study_id = target.study_id
        join public.quality_scores as score on score.session_id = interview.id
            and score.decision = 'approve'
        where interview.state in ('approved', 'paid')
            and interview.submitted_at is not null
            and offer.state = 'accepted'
            and not exists (select 1 from public.removals as removal
                where removal.session_id = interview.id)
        order by offer.respondent_id, interview.id
    )
    select jsonb_build_object('studyId', target.study_id,
        'quoteId', target.quote_id,
        'targetRespondents', target.purchased_slots,
        'approvedCompleteCount', (select count(*) from completed),
        'sessionIds', (select coalesce(jsonb_agg(session_id order by session_id),
            '[]'::jsonb) from completed))
    from target;
$$;
revoke all on function public.read_gate2_approved_complete_snapshot(
    uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_gate2_approved_complete_snapshot(
    uuid, uuid, uuid) to service_role;
