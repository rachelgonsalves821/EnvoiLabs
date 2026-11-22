-- Local fixture only. These users use reserved domains and have no login credentials.
-- Replay on every fresh setup so the fixture tests verify idempotency.
do $seed$
begin
    for attempt in 1..2 loop
        insert into public.pricing_configs (version, params_json, active)
        values (100, '{"unitPriceCents":100,"incentivePerQuestionCents":40}', true)
        on conflict do nothing;

        insert into public.organizations (id, name, design_partner)
        values ('90100000-0000-4000-8000-000000000001', 'Fixture research organization', true)
        on conflict (id) do nothing;

        insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
        select format('90200000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            'authenticated', 'authenticated', format('researcher%s@example.invalid', n),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
        from generate_series(1, 2) as series(n)
        union all
        select format('90300000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            'authenticated', 'authenticated', format('respondent%s@example.invalid', n),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
        from generate_series(1, 60) as series(n)
        on conflict (id) do nothing;

        insert into public.researchers (id, auth_user_id, organization_id, role, terms_version, terms_accepted_at)
        select format('90400000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            format('90200000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            '90100000-0000-4000-8000-000000000001'::uuid,
            case when n = 1 then 'admin' else 'member' end, 'fixture-1', '2026-11-19 00:00:00+00'::timestamptz
        from generate_series(1, 2) as series(n)
        on conflict (id) do nothing;

        insert into public.respondents (id, auth_user_id, age_attested_at, referral_code)
        select format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            format('90300000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            '2026-11-19 00:00:00+00'::timestamptz, format('fixture-%s', n)
        from generate_series(1, 60) as series(n)
        on conflict (id) do nothing;

        insert into public.profile_attributes (respondent_id, key, value_json, source)
        select format('90500000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
            attribute.key, attribute.value_json, 'signup'
        from generate_series(1, 60) as series(n)
        cross join lateral (values
            ('age', to_jsonb(18 + ((n - 1) % 28))),
            ('student', to_jsonb(n % 3 <> 0)),
            ('lives_on_campus', to_jsonb(n % 2 = 0 and n % 3 <> 0)),
            ('food_orders_per_week', to_jsonb(n % 6)),
            ('ordered_food_after_10pm_last_30_days', to_jsonb(n % 4 < 2)),
            ('preferred_food_order_channel', to_jsonb(case when n % 2 = 0 then 'app' else 'web' end))
        ) as attribute(key, value_json)
        on conflict (respondent_id, key) do nothing;

        insert into public.studies (id, organization_id, title, state, target_completes, length_minutes)
        values ('90600000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001',
            'Late-night food choices fixture', 'draft', 20, 15)
        on conflict (id) do nothing;
    end loop;
end;
$seed$;
