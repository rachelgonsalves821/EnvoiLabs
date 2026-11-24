-- A published quote must be backed by exactly one private accept/edit decision.
-- Dropped proposals remain private evidence and cannot enter the quote set.
create function internal.gate3_reviewed_quotes_match(
    supplied_quotes jsonb, supplied_reviews jsonb
) returns boolean language sql stable security definer set search_path = '' as $$
    select jsonb_typeof(supplied_quotes) = 'object'
        and jsonb_typeof(supplied_reviews) = 'array'
        and not exists (select 1 from jsonb_array_elements(supplied_reviews) as review
            where not (supplied_quotes ? (review ->> 'findingPosition')))
        and not exists (select 1 from jsonb_each(supplied_quotes) as expected(position, quotes)
            where jsonb_typeof(expected.quotes) <> 'array'
                or coalesce((select jsonb_agg(quote order by quote::text)
                    from jsonb_array_elements(expected.quotes) as quote), '[]'::jsonb)
                    is distinct from coalesce((select jsonb_agg(
                        review -> 'approvedQuote' order by (review -> 'approvedQuote')::text)
                        from jsonb_array_elements(supplied_reviews) as review
                        where review ->> 'findingPosition' = expected.position
                            and review ->> 'action' in ('accept', 'edit')), '[]'::jsonb));
$$;
revoke all on function internal.gate3_reviewed_quotes_match(jsonb, jsonb)
    from public, anon, authenticated, service_role;

create function public.publish_gate3_reviewed_report(
    supplied_report_id uuid, supplied_summary jsonb, supplied_claims jsonb,
    supplied_quotes jsonb, supplied_policy text, supplied_qualification text,
    supplied_reviews jsonb, supplied_positions jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    target public.reports%rowtype;
    item jsonb;
    prior_proposal pii.gate3_evidence_proposals%rowtype;
    prior_decision pii.gate3_evidence_decisions%rowtype;
    review_count integer;
    expected_count integer;
    proposal_uuid uuid;
    causation_uuid uuid;
    action_text text;
    approved jsonb;
    position_text text;
    finding_uuid uuid;
begin
    select * into target from public.reports where id = supplied_report_id for update;
    if not found or jsonb_typeof(supplied_reviews) <> 'array'
        or jsonb_array_length(supplied_reviews) = 0
        or not internal.gate3_report_quotes_match(supplied_report_id, supplied_quotes)
        or not internal.gate3_reviewed_quotes_match(supplied_quotes, supplied_reviews)
        or jsonb_typeof(supplied_positions) <> 'object'
        or (select count(*) from public.findings where report_id = target.id) <>
            (select count(*) from jsonb_object_keys(supplied_positions))
        or exists (select 1 from public.findings as finding
            where finding.report_id = target.id and (
                finding.study_id is distinct from target.study_id
                or supplied_positions ->> finding.id::text is distinct from finding.position::text))
    then return false; end if;
    select count(*) into review_count from jsonb_array_elements(supplied_reviews);
    select count(distinct review ->> 'proposalId') into expected_count
    from jsonb_array_elements(supplied_reviews) as review;
    if review_count <> expected_count then return false; end if;

    for item in select value from jsonb_array_elements(supplied_reviews) loop
        if jsonb_typeof(item) <> 'object'
            or jsonb_typeof(item -> 'candidate') <> 'object'
            or nullif(btrim(item ->> 'privateRationale'), '') is null
            or nullif(btrim(item ->> 'modelName'), '') is null
            or nullif(btrim(item ->> 'modelVersion'), '') is null
            or nullif(btrim(item ->> 'promptVersion'), '') is null
            or nullif(btrim(item ->> 'actorId'), '') is null
            or (item ->> 'findingPosition') !~ '^[1-9][0-9]*$'
            or (item ->> 'action') not in ('accept', 'edit', 'drop')
        then return false; end if;
        proposal_uuid := (item ->> 'proposalId')::uuid;
        causation_uuid := (item ->> 'causationId')::uuid;
        action_text := item ->> 'action';
        position_text := item ->> 'findingPosition';
        approved := item -> 'approvedQuote';
        select id into finding_uuid from public.findings
            where report_id = target.id and position = position_text::integer;
        if not (supplied_quotes ? position_text)
            or finding_uuid is null
            or (action_text = 'drop' and approved <> 'null'::jsonb)
            or (action_text in ('accept', 'edit') and jsonb_typeof(approved) <> 'object')
            or (action_text = 'edit' and nullif(btrim(coalesce(item ->> 'editedClaim',
                item ->> 'editedQuoteText', '')), '') is null)
            or (action_text <> 'edit' and (item ->> 'editedClaim' is not null
                or item ->> 'editedQuoteText' is not null))
            or (action_text = 'edit' and item ->> 'editedClaim' is not null
                and item ->> 'editedClaim' is distinct from
                    supplied_claims ->> finding_uuid::text)
            or (action_text = 'edit' and item ->> 'editedQuoteText' is not null
                and item ->> 'editedQuoteText' is distinct from approved ->> 'exactText')
        then return false; end if;
        if action_text = 'accept' and approved is distinct from jsonb_build_object(
            'studyId', item #>> '{candidate,studyId}',
            'transcriptId', item #>> '{candidate,transcriptId}',
            'sourceVersion', item #>> '{candidate,sourceVersion}',
            'startChar', item #> '{candidate,startChar}',
            'endChar', item #> '{candidate,endChar}',
            'exactText', item #>> '{candidate,exactText}')
        then return false; end if;
    end loop;

    if exists (select 1 from pii.gate3_report_publications
        where report_id = target.id) then
        if target.qualified_summary_json is distinct from supplied_summary
            or target.qualified_policy_digest is distinct from supplied_policy
            or target.qualified_qualification_digest is distinct from supplied_qualification
            or not exists (select 1 from pii.gate3_report_publications as receipt
                where receipt.report_id = target.id
                    and receipt.content_digest = internal.gate3_report_content_digest(target.id))
            or exists (select 1 from public.findings as finding
                where finding.report_id = target.id
                    and finding.qualified_claim is distinct from
                        supplied_claims ->> finding.id::text)
            or (select count(*) from pii.gate3_evidence_decisions as decision
                join pii.gate3_evidence_proposals as proposal on proposal.id = decision.proposal_id
                where proposal.report_id = target.id) <> review_count
        then return false; end if;
        for item in select value from jsonb_array_elements(supplied_reviews) loop
            select * into prior_proposal from pii.gate3_evidence_proposals
            where id = (item ->> 'proposalId')::uuid and report_id = target.id;
            select * into prior_decision from pii.gate3_evidence_decisions
            where proposal_id = prior_proposal.id and causation_id = (item ->> 'causationId')::uuid;
            if prior_proposal.id is null or prior_proposal.candidate_json is distinct from item -> 'candidate'
                or prior_proposal.model_name is distinct from item ->> 'modelName'
                or prior_proposal.model_version is distinct from item ->> 'modelVersion'
                or prior_proposal.prompt_version is distinct from item ->> 'promptVersion'
                or prior_proposal.private_rationale is distinct from item ->> 'privateRationale'
                or prior_decision.id is null or prior_decision.action is distinct from item ->> 'action'
                or prior_decision.actor_id is distinct from item ->> 'actorId'
                or prior_decision.private_note is distinct from item ->> 'privateNote'
                or prior_decision.edited_claim is distinct from item ->> 'editedClaim'
                or prior_decision.edited_quote_text is distinct from item ->> 'editedQuoteText'
            then return false; end if;
        end loop;
        return true;
    end if;

    if not public.publish_gate3_qualified_report(supplied_report_id, supplied_summary,
        supplied_claims, supplied_quotes, supplied_policy, supplied_qualification)
    then return false; end if;
    for item in select value from jsonb_array_elements(supplied_reviews) loop
        insert into pii.gate3_evidence_proposals
            (id, study_id, report_id, candidate_json, model_name, model_version,
                prompt_version, private_rationale)
        values ((item ->> 'proposalId')::uuid, target.study_id, target.id,
            item -> 'candidate', item ->> 'modelName', item ->> 'modelVersion',
            item ->> 'promptVersion', item ->> 'privateRationale');
        insert into pii.gate3_evidence_decisions
            (proposal_id, action, actor_id, causation_id, private_note,
                edited_claim, edited_quote_text)
        values ((item ->> 'proposalId')::uuid, item ->> 'action', item ->> 'actorId',
            (item ->> 'causationId')::uuid, item ->> 'privateNote',
            item ->> 'editedClaim', item ->> 'editedQuoteText');
    end loop;
    return true;
end;
$$;
revoke all on function public.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.publish_gate3_reviewed_report(
    uuid, jsonb, jsonb, jsonb, text, text, jsonb, jsonb) to service_role;
revoke execute on function public.publish_gate3_qualified_report(
    uuid, jsonb, jsonb, jsonb, text, text) from service_role;
revoke insert on pii.gate3_evidence_proposals, pii.gate3_evidence_decisions from service_role;

-- A withheld proposal must still leave private evidence even when there is no
-- qualified public report to publish. Exact causation replay is a no-op.
create function public.record_gate3_withheld_proposal(
    supplied_study_id uuid, supplied_report_id uuid, supplied_proposal_id uuid,
    supplied_candidate jsonb, supplied_model_name text, supplied_model_version text,
    supplied_prompt_version text, supplied_rationale text, supplied_actor text,
    supplied_causation_id uuid, supplied_reason text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
    prior_proposal pii.gate3_evidence_proposals%rowtype;
    prior_decision pii.gate3_evidence_decisions%rowtype;
begin
    if not exists (select 1 from public.studies where id = supplied_study_id)
        or (supplied_report_id is not null and not exists (
            select 1 from public.reports where id = supplied_report_id
                and study_id = supplied_study_id))
        or supplied_proposal_id is null or supplied_causation_id is null
        or jsonb_typeof(supplied_candidate) <> 'object'
        or nullif(btrim(supplied_model_name), '') is null
        or nullif(btrim(supplied_model_version), '') is null
        or nullif(btrim(supplied_prompt_version), '') is null
        or nullif(btrim(supplied_rationale), '') is null
        or nullif(btrim(supplied_actor), '') is null
        or nullif(btrim(supplied_reason), '') is null
    then return false; end if;
    insert into pii.gate3_evidence_proposals
        (id, study_id, report_id, candidate_json, model_name, model_version,
            prompt_version, private_rationale)
    values (supplied_proposal_id, supplied_study_id, supplied_report_id,
        supplied_candidate, supplied_model_name, supplied_model_version,
        supplied_prompt_version, supplied_rationale)
    on conflict (id) do nothing;
    select * into prior_proposal from pii.gate3_evidence_proposals
        where id = supplied_proposal_id;
    if prior_proposal.study_id is distinct from supplied_study_id
        or prior_proposal.report_id is distinct from supplied_report_id
        or prior_proposal.candidate_json is distinct from supplied_candidate
        or prior_proposal.model_name is distinct from supplied_model_name
        or prior_proposal.model_version is distinct from supplied_model_version
        or prior_proposal.prompt_version is distinct from supplied_prompt_version
        or prior_proposal.private_rationale is distinct from supplied_rationale
        or exists (select 1 from pii.gate3_evidence_decisions
            where proposal_id = supplied_proposal_id and causation_id <> supplied_causation_id)
    then return false; end if;
    insert into pii.gate3_evidence_decisions
        (proposal_id, action, actor_id, causation_id, private_note)
    values (supplied_proposal_id, 'drop', supplied_actor, supplied_causation_id, supplied_reason)
    on conflict (proposal_id, causation_id) do nothing;
    select * into prior_decision from pii.gate3_evidence_decisions
        where proposal_id = supplied_proposal_id and causation_id = supplied_causation_id;
    return prior_decision.action = 'drop'
        and prior_decision.actor_id = supplied_actor
        and prior_decision.private_note = supplied_reason;
end;
$$;
revoke all on function public.record_gate3_withheld_proposal(
    uuid, uuid, uuid, jsonb, text, text, text, text, text, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.record_gate3_withheld_proposal(
    uuid, uuid, uuid, jsonb, text, text, text, text, text, uuid, text) to service_role;

-- Every report and export read re-enters the current RLS projection in one
-- statement snapshot; callers cannot reuse an earlier authorized payload.
create function public.read_gate3_qualified_report(
    supplied_study_id uuid, supplied_report_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object(
        'report', jsonb_build_object('id', report.id, 'studyId', report.study_id,
            'version', report.version, 'state', report.state,
            'summary', report.summary_json),
        'findings', coalesce((select jsonb_agg(jsonb_build_object(
            'id', finding.id, 'position', finding.position,
            'claim', finding.claim, 'count', finding.count,
            'total', finding.total, 'confidence', finding.confidence,
            'quotes', coalesce((select jsonb_agg(jsonb_build_object(
                'id', quote.id, 'transcriptId', quote.transcript_id,
                'sourceVersion', quote.source_version,
                'startChar', quote.start_char, 'endChar', quote.end_char,
                'exactText', quote.text) order by quote.id)
                from research.evidence_quotes as quote
                where quote.finding_id = finding.id), '[]'::jsonb))
            order by finding.position)
            from research.findings as finding where finding.report_id = report.id), '[]'::jsonb))
    from research.reports as report
    where report.id = supplied_report_id and report.study_id = supplied_study_id
        and internal.gate3_report_current(report.id);
$$;
revoke all on function public.read_gate3_qualified_report(uuid, uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_qualified_report(uuid, uuid) to authenticated;

-- The latest report identity is read under the same statement snapshot as the
-- qualified payload. A withheld newer version must not expose an older one.
create function internal.gate3_latest_report_id(supplied_study_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
    select report.id from public.reports as report
    where report.study_id = supplied_study_id
        and internal.researches_study(supplied_study_id)
    order by report.version desc, report.created_at desc, report.id desc limit 1;
$$;
revoke all on function internal.gate3_latest_report_id(uuid)
    from public, anon, authenticated, service_role;
grant execute on function internal.gate3_latest_report_id(uuid) to authenticated;

create function public.read_gate3_current_qualified_report(supplied_study_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
    select public.read_gate3_qualified_report(supplied_study_id,
        internal.gate3_latest_report_id(supplied_study_id));
$$;
revoke all on function public.read_gate3_current_qualified_report(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_current_qualified_report(uuid) to authenticated;
