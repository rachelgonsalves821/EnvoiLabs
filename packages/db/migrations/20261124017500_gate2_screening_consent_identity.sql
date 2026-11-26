-- A new grant with the same text cannot reactivate a decision made under a
-- withdrawn grant. Historic decisions without a binding fail closed.
create table internal.gate2_screening_decision_grants (
    event_id uuid primary key references public.gate2_screening_events (id),
    consent_id uuid not null,
    recorded_at timestamptz not null default now()
);
alter table internal.gate2_screening_decision_grants enable row level security;
revoke all on internal.gate2_screening_decision_grants
    from public, anon, authenticated, service_role;
create trigger immutable_gate2_screening_decision_grants
    before update or delete on internal.gate2_screening_decision_grants
    for each row execute function internal.reject_gate2_ledger_mutation();

create function internal.gate2_bind_screening_decision_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
    answer pii.gate2_screener_answers%rowtype;
    target_respondent_id uuid;
    current_grant public.consents%rowtype;
    qualified_source jsonb;
begin
    if new.redacted_source_version is null then return new; end if;
    select * into answer from pii.gate2_screener_answers where id = new.answer_id;
    select offer.respondent_id into target_respondent_id from public.invites as offer
    where offer.id = answer.invite_id and offer.study_id = answer.study_id;
    select * into current_grant from public.consents as grant_row
    where grant_row.respondent_id = target_respondent_id
        and grant_row.study_id = answer.study_id
        and grant_row.purpose = 'ai_screening'
    order by grant_row.created_at desc, grant_row.recorded_sequence desc limit 1;
    qualified_source := public.current_gate2_screening_model_source(
        answer.study_id, answer.id, new.rule_id, new.rule_version,
        new.provider_model, new.prompt_version, new.prompt_digest);
    if current_grant.id is null or not current_grant.granted
        or qualified_source ->> 'redactedSourceVersion'
            is distinct from new.redacted_source_version::text
        or qualified_source ->> 'redactionPolicyDigest'
            is distinct from new.redaction_policy_digest
    then raise check_violation; end if;
    insert into internal.gate2_screening_decision_grants (event_id, consent_id)
    values (new.id, current_grant.id);
    return new;
end;
$$;
revoke all on function internal.gate2_bind_screening_decision_grant()
    from public, anon, authenticated, service_role;
create trigger gate2_bind_screening_decision_grant
    after insert on public.gate2_screening_events for each row
    execute function internal.gate2_bind_screening_decision_grant();

create or replace function public.get_gate2_current_qualified_screening_decision(
    requested_answer_id uuid, requested_provider_model text,
    requested_prompt_version text, requested_prompt_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
    select internal.gate2_screening_event_json(event) || jsonb_build_object(
        'redactedSourceVersion', event.redacted_source_version,
        'redactionPolicyDigest', event.redaction_policy_digest)
    from public.gate2_screening_events as event
    join pii.gate2_screener_answers as answer on answer.id = event.answer_id
    join public.invites as offer on offer.id = answer.invite_id
        and offer.study_id = answer.study_id
    join internal.gate2_screening_decision_grants as binding
        on binding.event_id = event.id
    join lateral (
        select grant_row.id from public.consents as grant_row
        where grant_row.respondent_id = offer.respondent_id
            and grant_row.study_id = answer.study_id
            and grant_row.purpose = 'ai_screening'
        order by grant_row.created_at desc, grant_row.recorded_sequence desc
        limit 1
    ) as current_grant on current_grant.id = binding.consent_id
    cross join lateral (select public.current_gate2_screening_model_source(
        answer.study_id, answer.id, event.rule_id, event.rule_version,
        requested_provider_model, requested_prompt_version,
        requested_prompt_digest) as value) as current_source
    where event.answer_id = requested_answer_id
        and event.redacted_source_version is not null
        and event.provider_model = requested_provider_model
        and event.prompt_version = requested_prompt_version
        and event.prompt_digest = requested_prompt_digest
        and current_source.value ->> 'redactedSourceVersion'
            = event.redacted_source_version::text
        and current_source.value ->> 'redactionPolicyDigest'
            = event.redaction_policy_digest;
$$;

-- Keep exact replay behavior for a current event, while preventing the
-- privileged caller from receiving an old decision after regrant.
alter function public.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) set schema internal;
alter function internal.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) rename to commit_gate2_screening_decision_inner;
revoke all on function internal.commit_gate2_screening_decision_inner(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) from public, anon, authenticated, service_role;
create function public.commit_gate2_qualified_screening_decision(
    requested_answer_id uuid, requested_rule_id uuid, requested_version integer,
    requested_interpretation text, requested_start integer, requested_end integer,
    requested_action text, requested_confirmed boolean,
    requested_source_version uuid, requested_redaction_policy_digest text,
    requested_provider_model text, requested_prompt_version text,
    requested_prompt_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    if exists (select 1 from public.gate2_screening_events
        where answer_id = requested_answer_id)
        and public.get_gate2_current_qualified_screening_decision(
            requested_answer_id, requested_provider_model,
            requested_prompt_version, requested_prompt_digest) is null
    then raise check_violation; end if;
    return internal.commit_gate2_screening_decision_inner(
        requested_answer_id, requested_rule_id, requested_version,
        requested_interpretation, requested_start, requested_end,
        requested_action, requested_confirmed, requested_source_version,
        requested_redaction_policy_digest, requested_provider_model,
        requested_prompt_version, requested_prompt_digest);
end;
$$;
revoke all on function public.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.commit_gate2_qualified_screening_decision(
    uuid, uuid, integer, text, integer, integer, text, boolean,
    uuid, text, text, text, text) to service_role;
