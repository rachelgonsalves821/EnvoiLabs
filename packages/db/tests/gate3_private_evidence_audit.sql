begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select ok(not has_table_privilege('authenticated', 'pii.gate3_evidence_proposals', 'SELECT')
    and not has_table_privilege('authenticated', 'pii.gate3_evidence_decisions', 'SELECT'),
    'researcher cannot read private proposal or decision records');
select ok(not has_table_privilege('service_role', 'pii.gate3_evidence_proposals', 'UPDATE, DELETE')
    and not has_table_privilege('service_role', 'pii.gate3_evidence_decisions', 'UPDATE, DELETE'),
    'service role cannot rewrite audit history');

set local role service_role;
insert into pii.gate3_evidence_proposals (id, study_id, candidate_json,
    model_name, model_version, prompt_version, private_rationale)
values ('a9800000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001',
    '{"claim":"Synthetic candidate","exactText":"ordered"}',
    'fictional-model', 'model-v1', 'prompt-v2',
    'Private rationale naming Ada Example at ada@example.test');
select is((select private_rationale from pii.gate3_evidence_proposals
    where id = 'a9800000-0000-4000-8000-000000000001'),
    'Private rationale naming Ada Example at ada@example.test',
    'restricted service retains private model rationale');
insert into pii.gate3_evidence_decisions (proposal_id, action, actor_id, causation_id)
values ('a9800000-0000-4000-8000-000000000001', 'accept', 'fixture-analyst',
    'a9800000-0000-4000-8000-000000000002');
insert into pii.gate3_evidence_decisions (proposal_id, action, actor_id, causation_id,
    edited_claim, private_note)
values ('a9800000-0000-4000-8000-000000000001', 'edit', 'fixture-analyst',
    'a9800000-0000-4000-8000-000000000003', 'Qualified synthetic claim',
    'Edited after source review');
insert into pii.gate3_evidence_decisions (proposal_id, action, actor_id, causation_id)
values ('a9800000-0000-4000-8000-000000000001', 'drop', 'fixture-analyst',
    'a9800000-0000-4000-8000-000000000004');
select is((select count(*) from pii.gate3_evidence_decisions
    where proposal_id = 'a9800000-0000-4000-8000-000000000001'), 3::bigint,
    'accept edit and drop decisions remain in orderable history');
select throws_ok($$insert into pii.gate3_evidence_decisions
    (proposal_id, action, actor_id, causation_id) values
    ('a9800000-0000-4000-8000-000000000001', 'accept', 'fixture-analyst',
    'a9800000-0000-4000-8000-000000000002')$$,
    '23505', null, 'decision replay is idempotent by proposal and causation');
select throws_ok($$insert into pii.gate3_evidence_decisions
    (proposal_id, action, actor_id, causation_id) values
    ('a9800000-0000-4000-8000-000000000001', 'edit', 'fixture-analyst',
    'a9800000-0000-4000-8000-000000000005')$$,
    '23514', null, 'edit requires its private edited content');
reset role;
select throws_ok($$update pii.gate3_evidence_proposals set private_rationale = 'rewritten'$$,
    '23514', null, 'proposal is append only even for privileged writer');
select throws_ok($$delete from pii.gate3_evidence_proposals$$,
    '23514', null, 'proposal cannot be deleted');
select throws_ok($$update pii.gate3_evidence_decisions set action = 'drop'$$,
    '23514', null, 'decision is append only even for privileged writer');
select throws_ok($$delete from pii.gate3_evidence_decisions$$,
    '23514', null, 'decision cannot be deleted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"90200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select throws_ok($$select private_rationale from pii.gate3_evidence_proposals$$,
    '42501', null, 'MFA researcher cannot read private model rationale');
select throws_ok($$select private_note from pii.gate3_evidence_decisions$$,
    '42501', null, 'MFA researcher cannot read private decision notes');
select * from finish();
rollback;

