-- Prototype for the disposable stack and the Gate 2 migration handoff.
create function public.list_gate1_expired_audio(supplied_limit integer)
returns table (storage_path text)
language sql security definer set search_path = ''
as $$
    select stored.name
    from internal.gate1_audio_uploads as reservation
    join storage.objects as stored on stored.bucket_id = 'gate1-interview-audio'
        and stored.name = reservation.session_id::text || '/' || reservation.id::text
    where reservation.confirmed_answer_id is null
        and reservation.expires_at <= statement_timestamp()
        and not exists (
            select 1 from pii.audio_objects as confirmed where confirmed.storage_path = stored.name
        )
    order by reservation.expires_at, reservation.id
    limit greatest(0, least(coalesce(supplied_limit, 0), 50))
    for update of reservation skip locked;
$$;

revoke all on function public.list_gate1_expired_audio(integer) from public, anon, authenticated, service_role;
grant execute on function public.list_gate1_expired_audio(integer) to service_role;
