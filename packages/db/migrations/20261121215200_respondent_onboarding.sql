-- These RPCs derive ownership from the authenticated principal and serialize decisions per respondent.
create function internal.lock_active_respondent() returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
    owner_id uuid;
begin
    select respondents.id into owner_id
    from public.respondents
    join auth.users on users.id = respondents.auth_user_id
    where respondents.auth_user_id = auth.uid()
        and respondents.status = 'active'
        and users.email_confirmed_at is not null
    for update of respondents;
    if owner_id is null then
        raise insufficient_privilege;
    end if;
    return owner_id;
end;
$$;

revoke all on function internal.lock_active_respondent() from public, anon, authenticated, service_role;

create function public.save_gate1_profile(attributes jsonb) returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    item jsonb;
    field text;
    value jsonb;
    scalar text;
    seen text[] := '{}';
begin
    if jsonb_typeof(attributes) is distinct from 'array' then
        raise invalid_parameter_value;
    end if;
    if jsonb_array_length(attributes) not between 1 and 8 then
        raise invalid_parameter_value;
    end if;

    for item in select * from jsonb_array_elements(attributes) loop
        if jsonb_typeof(item) is distinct from 'object'
            or not (item ?& array['key', 'value']) or item - array['key', 'value'] <> '{}'::jsonb
        then
            raise invalid_parameter_value;
        end if;
        field := item ->> 'key';
        value := item -> 'value';
        scalar := value #>> '{}';
        if field is null or field = any(seen) or (
            case field
                when 'age_range' then scalar in ('18-24', '25-34', '35-44', '45-54', '55-64', '65+')
                when 'gender' then scalar in ('woman', 'man', 'nonbinary', 'another', 'undisclosed')
                when 'student_year' then scalar in (
                    'not_student', 'year_1', 'year_2', 'year_3', 'year_4_plus', 'graduate', 'other'
                )
                when 'lives_on_campus' then jsonb_typeof(value) = 'boolean'
                when 'region_zip' then jsonb_typeof(value) = 'string' and scalar ~ '^[0-9]{5}$'
                when 'food_orders_per_week' then jsonb_typeof(value) = 'number' and scalar ~ '^(0|[1-9][0-9]?)$'
                when 'online_shopping_frequency' then scalar in (
                    'less_than_monthly', 'monthly', 'weekly', 'several_per_week', 'never'
                )
                when 'interests' then case when jsonb_typeof(value) = 'array' then
                    jsonb_array_length(value) between 2 and 3
                    and value <@ '["food","shopping","campus","technology","travel","media"]'::jsonb
                    and jsonb_array_length(value) = (select count(distinct choice) from jsonb_array_elements(value) as choices(choice))
                    else false end
                else false
            end
        ) is distinct from true then
            raise invalid_parameter_value;
        end if;

        seen := array_append(seen, field);
        insert into public.profile_attributes as existing (respondent_id, key, value_json, source)
        values (owner_id, field, value, 'signup')
        on conflict (respondent_id, key) do update set value_json = excluded.value_json, source = excluded.source
        where existing.value_json is distinct from excluded.value_json;

        if field = 'student_year' then
            insert into public.profile_attributes as existing (respondent_id, key, value_json, source)
            values (owner_id, 'student', to_jsonb(scalar <> 'not_student'), 'signup')
            on conflict (respondent_id, key) do update set value_json = excluded.value_json, source = excluded.source
            where existing.value_json is distinct from excluded.value_json;
        end if;
    end loop;
    return true;
end;
$$;

create function public.save_gate1_consent(decisions jsonb) returns boolean
language plpgsql security definer set search_path = pg_catalog
as $$
declare
    owner_id uuid := internal.lock_active_respondent();
    item jsonb;
    purpose_key text;
    consent_version constant text := 'gate1-preview-v1';
    allowed boolean;
    saved_at timestamptz;
    seen text[] := '{}';
    previous public.consents%rowtype;
begin
    if jsonb_typeof(decisions) is distinct from 'array' then
        raise invalid_parameter_value;
    end if;
    if jsonb_array_length(decisions) <> 4 then
        raise invalid_parameter_value;
    end if;
    for item in select * from jsonb_array_elements(decisions) loop
        purpose_key := item ->> 'purpose';
        if jsonb_typeof(item) is distinct from 'object'
            or item - array['purpose', 'granted', 'textVersion'] <> '{}'::jsonb
            or purpose_key is null or purpose_key = any(seen)
            or purpose_key not in ('recording', 'transcription_vendor', 'retention', 'researcher_access')
            or jsonb_typeof(item -> 'granted') is distinct from 'boolean'
            or item ->> 'textVersion' is distinct from consent_version
        then
            raise invalid_parameter_value;
        end if;

        seen := array_append(seen, purpose_key);
        allowed := (item ->> 'granted')::boolean;
        select * into previous from public.consents
        where respondent_id = owner_id and purpose = purpose_key and study_id is null
        order by created_at desc, recorded_sequence desc limit 1;
        if previous.granted is distinct from allowed or previous.text_version is distinct from consent_version then
            saved_at := greatest(clock_timestamp(), previous.created_at);
            insert into public.consents (respondent_id, purpose, granted, text_version, created_at, updated_at)
            values (owner_id, purpose_key, allowed, consent_version, saved_at, saved_at);
        end if;
    end loop;
    return true;
end;
$$;

revoke all on function public.save_gate1_profile(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_gate1_consent(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_gate1_profile(jsonb) to authenticated;
grant execute on function public.save_gate1_consent(jsonb) to authenticated;
