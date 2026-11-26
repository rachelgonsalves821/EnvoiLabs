-- Loaded only into the disposable local Auth database, never as a migration.
create function public.prepare_gate2_visa_e2e_fixture(requested_respondent_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare fixture_email text;
begin
    select account.email into fixture_email
    from public.respondents as respondent
    join auth.users as account on account.id = respondent.auth_user_id
    where respondent.id = requested_respondent_id
        and respondent.status = 'active';
    if fixture_email is null or fixture_email !~ '^gate2-market-.*@example\.test$'
    then raise check_violation using message = 'local synthetic respondent required'; end if;
    if not exists (
        select 1 from public.sessions as interview
        join public.invites as offer on offer.id = interview.invite_id
        where offer.respondent_id = requested_respondent_id
            and interview.state = 'approved'
        group by offer.respondent_id having count(*) >= 3
    ) then raise check_violation using message = 'three approved sessions required'; end if;
    insert into internal.gate2_sandbox_visa_products
        (country, product_id, minimum_cents, maximum_cents, catalog_receipt)
    values ('US', 'sandbox_visa', 1000, 50000,
        'synthetic:browser_catalog_1') on conflict (country) do nothing;
    insert into internal.gate2_sandbox_visa_routes
        (respondent_id, recipient_name, recipient_email, country, verification_receipt)
    values (requested_respondent_id, 'Synthetic Browser Person', fixture_email,
        'US', 'synthetic:browser_route_1');
    update public.sessions as interview
    set started_at = now() - interval '26 hours',
        submitted_at = now() - interval '25 hours'
    from public.invites as offer
    where interview.invite_id = offer.id
        and offer.respondent_id = requested_respondent_id
        and interview.state = 'approved';
    return true;
end;
$$;
revoke all on function public.prepare_gate2_visa_e2e_fixture(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.prepare_gate2_visa_e2e_fixture(uuid)
    to service_role;
