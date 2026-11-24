begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into public.brief_versions (study_id, version, brief_json, created_by)
values ('90600000-0000-4000-8000-000000000001', 1, '{}',
    '90400000-0000-4000-8000-000000000001');

insert into public.gate2_quote_snapshots (id, study_id, brief_version, guide_digest,
    pricing_config_id, pricing_config_version, line_items_json, total_cents,
    incentive_cents_per_complete, feasibility_json)
select '99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 1, repeat('a', 64), id, version,
    '[{"label":"Core questions","coreQuestionCount":5,"respondentCount":1,"unitPriceCents":100,"amountCents":500}]',
    500, 200, '{"expectedCompletes":1,"hours":24}' from public.pricing_configs where active;

select is((select pricing_config_version from public.gate2_quote_snapshots where id =
    '99600000-0000-4000-8000-000000000001'),
    (select version from public.pricing_configs where active), 'quote stores config version');
select throws_ok($$update public.gate2_quote_snapshots set total_cents = 600 where id =
    '99600000-0000-4000-8000-000000000001'$$, '23514', null, 'quote cannot be changed');
select throws_ok($$delete from public.gate2_quote_snapshots where id =
    '99600000-0000-4000-8000-000000000001'$$, '23514', null, 'quote cannot be deleted');

insert into public.gate2_payment_events (quote_id, study_id, provider_checkout_id,
    provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
values ('99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_paid', 'paid', 500, 'usd', now());
select is((select count(*) from public.gate2_payment_events where event_kind = 'paid'),
    1::bigint, 'verified payment event is recorded once');
select throws_ok($$insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
    values ('99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_paid', 'paid', 500, 'usd', now())$$,
    '23505', null, 'replayed provider event is unique');
select throws_ok($$insert into public.gate2_payment_events (quote_id, study_id,
    provider_checkout_id, provider_event_id, event_kind, amount_cents, currency, provider_observed_at)
    values ('99600000-0000-4000-8000-000000000001',
    '90600000-0000-4000-8000-000000000001', 'cs_fixture', 'evt_paid_again', 'paid', 500, 'usd', now())$$,
    '23505', null, 'a quote has one paid event');
select throws_ok($$update public.gate2_payment_events set amount_cents = 300
    where provider_event_id = 'evt_paid'$$, '23514', null, 'provider observation cannot change');
select ok(not has_table_privilege('authenticated', 'public.gate2_payment_events', 'SELECT'),
    'provider events are private');
select ok(not has_table_privilege('service_role', 'public.gate2_quote_snapshots', 'UPDATE'),
    'service cannot mutate a quote');
select ok(not has_table_privilege('service_role', 'public.gate2_payment_events', 'DELETE'),
    'service cannot erase provider evidence');
select * from finish();
rollback;
