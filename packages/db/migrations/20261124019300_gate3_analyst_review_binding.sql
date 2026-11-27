-- The private analyst worker may only use a source set separately attested
-- by a current AAL2 researcher. This receipt is not a public report approval.
alter function public.read_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text)
    rename to read_gate3_analyst_candidate_snapshot;
revoke all on function public.read_gate3_analyst_candidate_snapshot(
    uuid, uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;

create table internal.gate3_analyst_review_receipts (
    id uuid primary key default gen_random_uuid(),
    study_id uuid not null,
    quote_id uuid not null,
    actor_auth_user_id uuid not null,
    causation_id uuid not null unique,
    source_set_version uuid not null default gen_random_uuid(),
    consent_revision uuid not null default gen_random_uuid(),
    candidate_json jsonb not null,
    attested_at timestamptz not null default clock_timestamp(),
    unique (study_id, quote_id, candidate_json)
);
alter table internal.gate3_analyst_review_receipts enable row level security;
revoke all on internal.gate3_analyst_review_receipts
    from public, anon, authenticated, service_role;
create trigger immutable_gate3_analyst_review_receipts
    before update or delete on internal.gate3_analyst_review_receipts
    for each row execute function internal.reject_gate2_ledger_mutation();

create function public.attest_gate3_analyst_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_actor_auth_user_id uuid, supplied_causation_id uuid,
    supplied_provider_model text, supplied_prompt_version text,
    supplied_prompt_digest text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare current_candidate jsonb; prior internal.gate3_analyst_review_receipts%rowtype;
begin
    if auth.uid() is distinct from supplied_actor_auth_user_id
        or auth.jwt() ->> 'aal' is distinct from 'aal2'
        or supplied_causation_id is null then return null; end if;
    select * into prior from internal.gate3_analyst_review_receipts
        where causation_id = supplied_causation_id;
    if found then
        return case when prior.study_id = supplied_study_id
            and prior.quote_id = supplied_quote_id
            and prior.actor_auth_user_id = supplied_actor_auth_user_id
            and prior.candidate_json = public.read_gate3_analyst_candidate_snapshot(
                supplied_study_id, supplied_quote_id,
                supplied_actor_auth_user_id, supplied_provider_model,
                supplied_prompt_version, supplied_prompt_digest)
            then prior.id else null end;
    end if;
    perform 1 from public.studies where id = supplied_study_id for update;
    current_candidate := public.read_gate3_analyst_candidate_snapshot(
        supplied_study_id, supplied_quote_id, supplied_actor_auth_user_id,
        supplied_provider_model, supplied_prompt_version,
        supplied_prompt_digest);
    if current_candidate is null then return null; end if;
    select * into prior from internal.gate3_analyst_review_receipts
        where study_id = supplied_study_id and quote_id = supplied_quote_id
            and candidate_json = current_candidate;
    if found then return prior.id; end if;
    insert into internal.gate3_analyst_review_receipts
        (study_id, quote_id, actor_auth_user_id, causation_id, candidate_json)
    values (supplied_study_id, supplied_quote_id,
        supplied_actor_auth_user_id, supplied_causation_id, current_candidate)
    returning id into prior.id;
    return prior.id;
end;
$$;
revoke all on function public.attest_gate3_analyst_snapshot(
    uuid, uuid, uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.attest_gate3_analyst_snapshot(
    uuid, uuid, uuid, uuid, text, text, text) to authenticated;

create function public.read_gate3_analyst_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid, supplied_provider_model text,
    supplied_prompt_version text, supplied_prompt_digest text
) returns jsonb language sql stable security definer set search_path = '' as $$
    with candidate as (
        select public.read_gate3_analyst_candidate_snapshot(
            supplied_study_id, supplied_quote_id,
            supplied_researcher_auth_user_id, supplied_provider_model,
            supplied_prompt_version, supplied_prompt_digest) as payload
    )
    select candidate.payload || jsonb_build_object(
        'quoteId', review.quote_id,
        'sourceSetVersion', review.source_set_version,
        'consentRevision', review.consent_revision,
        'reviewerReceiptId', review.id,
        'briefVersion', quote.brief_version,
        'pricingConfigVersion', quote.pricing_config_version)
    from candidate
    join internal.gate3_analyst_review_receipts as review
        on review.study_id = supplied_study_id
        and review.quote_id = supplied_quote_id
        and review.candidate_json = candidate.payload
    join public.gate2_quote_snapshots as quote on quote.id = review.quote_id
        and quote.study_id = review.study_id
    where candidate.payload is not null
    order by review.attested_at desc limit 1;
$$;
revoke all on function public.read_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
grant execute on function public.read_gate3_analyst_snapshot(
    uuid, uuid, uuid, text, text, text) to service_role;

-- Rebind authorization to the reviewed reader, including its new version
-- identities; the earlier SQL body must never authorize a bare candidate.
create or replace function public.authorize_gate3_analyst_snapshot(
    supplied_study_id uuid, supplied_quote_id uuid,
    supplied_researcher_auth_user_id uuid, supplied_provider_model text,
    supplied_prompt_version text, supplied_prompt_digest text,
    supplied_snapshot jsonb
) returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce(supplied_snapshot is not null and supplied_snapshot =
        public.read_gate3_analyst_snapshot(supplied_study_id,
            supplied_quote_id, supplied_researcher_auth_user_id,
            supplied_provider_model, supplied_prompt_version,
            supplied_prompt_digest), false);
$$;
