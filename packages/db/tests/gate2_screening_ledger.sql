begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into public.criteria (id, study_id, kind, attribute_key, operator, value_json, text)
values ('99610000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'must', 'late_order', 'eq', 'true', 'Ordered late');
insert into public.invites (id, study_id, respondent_id, state, reward_cents, expires_at)
values ('99610000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '90500000-0000-4000-8000-000000000001', 'screening', 200, now() + interval '1 day');
insert into public.gate2_screening_rules (id, study_id, criterion_id, version,
    criterion_kind, question, approved_by, approved_at)
values ('99610000-0000-4000-8000-000000000003',
    '90600000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000001', 1, 'must',
    'Did you order late?', '90400000-0000-4000-8000-000000000001', now());
insert into pii.gate2_screener_answers (id, invite_id, study_id, rule_id,
    rule_version, kind, answer_text, idempotency_key)
values ('99610000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000003', 1, 'text',
    'I ordered last week', 'screen:fixture:1');

select throws_ok($$insert into pii.gate2_screener_answers (invite_id, study_id,
    rule_id, rule_version, kind, answer_text, idempotency_key)
    values ('99610000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000003', 1, 'voice', 'yes', 'screen:fixture:2')$$,
    '23514', null, 'voice needs recorded transcription consent');
select throws_ok($$insert into pii.gate2_screener_answers (invite_id, study_id,
    rule_id, rule_version, kind, answer_text, idempotency_key)
    values ('99610000-0000-4000-8000-000000000002',
    '90600000-0000-4000-8000-000000000001',
    '99610000-0000-4000-8000-000000000003', 1, 'text', 'yes', 'screen:fixture:1')$$,
    '23505', null, 'repeated answer delivery keeps one row');
select throws_ok($$insert into public.gate2_screening_events (answer_id, rule_id,
    rule_version, interpretation, start_char, end_char, action, confirmed_fact)
    values ('99610000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000003', 1, 'contradicted', 0, 99, 'screen_out', false)$$,
    '23514', null, 'invalid source span cannot exclude');
select throws_ok($$insert into public.gate2_screening_events (answer_id, rule_id,
    rule_version, interpretation, action, confirmed_fact)
    values ('99610000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000003', 1, 'unclear', 'screen_out', false)$$,
    '23514', null, 'unclear evidence cannot exclude');
insert into public.gate2_screening_events (answer_id, rule_id, rule_version,
    interpretation, start_char, end_char, action, confirmed_fact)
values ('99610000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000003', 1, 'supported', 2, 19, 'qualify', true);
select is((select action from public.gate2_screening_events where answer_id =
    '99610000-0000-4000-8000-000000000004'), 'qualify', 'valid evidence is recorded');
select throws_ok($$insert into public.gate2_screening_events (answer_id, rule_id,
    rule_version, interpretation, start_char, end_char, action, confirmed_fact)
    values ('99610000-0000-4000-8000-000000000004',
    '99610000-0000-4000-8000-000000000003', 1, 'supported', 2, 19, 'qualify', true)$$,
    '23505', null, 'replayed decision keeps one row');
select throws_ok($$update public.gate2_screening_events set action = 'screen_out'$$,
    '23514', null, 'screening evidence is immutable');
select ok(not has_table_privilege('authenticated', 'pii.gate2_screener_answers', 'SELECT'),
    'raw screening answers are private');
select ok(not has_table_privilege('authenticated', 'public.gate2_screening_events', 'SELECT'),
    'decisions are private');
select ok(not has_table_privilege('service_role', 'public.gate2_screening_rules', 'UPDATE'),
    'approved rules are immutable');
select * from finish();
rollback;
