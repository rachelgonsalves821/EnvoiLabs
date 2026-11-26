-- The private cleanup service may delete only expired, unconfirmed uploads.
-- A confirmed voice source stays under the still-pending retention policy.
create function public.list_gate2_expired_screening_audio(supplied_limit integer)
returns table (storage_path text)
language sql security definer set search_path = '' as $$
    select stored.name
    from internal.gate2_screening_audio_uploads as reservation
    join storage.objects as stored on stored.bucket_id = 'gate2-screening-audio'
        and stored.name = 'screening/' || reservation.invite_id || '/' || reservation.id
    where reservation.confirmed_at is null
        and reservation.expires_at <= statement_timestamp()
        and reservation.receipt_id is null
    order by reservation.expires_at, reservation.id
    limit greatest(0, least(coalesce(supplied_limit, 0), 50))
    for update of reservation skip locked;
$$;
revoke all on function public.list_gate2_expired_screening_audio(integer)
    from public, anon, authenticated, service_role;
grant execute on function public.list_gate2_expired_screening_audio(integer)
    to service_role;
