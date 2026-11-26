-- The immutable outbox row is the keyset cursor. A job reads at most five
-- pages; the next job starts at the oldest remaining dispatchable row.
revoke all on function public.list_gate2_offer_push_dispatchable()
    from public, anon, authenticated, service_role;

create index gate2_offer_push_outbox_queue_order
    on internal.gate2_offer_push_outbox (queued_at, id);

create function public.list_gate2_offer_push_dispatch_page(
    supplied_after_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(page.id order by page.queued_at, page.id), '[]'::jsonb)
    from (select item.id, item.queued_at
        from internal.gate2_offer_push_outbox as item
        join public.invites as offer on offer.id = item.invite_id
        left join internal.gate2_offer_push_outbox as cursor
            on cursor.id = supplied_after_id
        where (supplied_after_id is null or (cursor.id is not null
            and (item.queued_at, item.id) > (cursor.queued_at, cursor.id)))
            and internal.gate2_offer_push_current(offer)
            and item.consent_receipt = internal.gate2_offer_push_consent_receipt(
                offer.respondent_id, offer.study_id)
            and (not exists (select 1 from internal.gate2_offer_push_deliveries
                where outbox_id = item.id)
                or exists (select 1 from internal.gate2_offer_push_deliveries as delivery
                    join public.push_subscriptions as subscription
                        on subscription.id = delivery.subscription_id
                    where delivery.outbox_id = item.id and delivery.state = 'queued'))
        order by item.queued_at, item.id limit 100) as page;
$$;
revoke all on function public.list_gate2_offer_push_dispatch_page(uuid)
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_offer_push_dispatch_page(uuid)
    to service_role;
