create function public.create_gate1_study(
    supplied_researcher_id uuid,
    supplied_organization_id uuid,
    supplied_study_id uuid,
    draft jsonb,
    predicates jsonb
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
    saved_id uuid;
    saved_state text;
begin
    perform 1 from public.researchers
    where id = supplied_researcher_id and organization_id = supplied_organization_id
    for share;
    if not found then
        raise insufficient_privilege;
    end if;

    insert into public.studies (id, organization_id, title, target_completes, length_minutes)
    values (supplied_study_id, supplied_organization_id, draft->>'title',
        (draft->>'targetCompletes')::integer, 15)
    on conflict (id) do nothing
    returning id, state into saved_id, saved_state;

    if saved_id is null then
        select studies.id, studies.state into saved_id, saved_state
        from public.studies join public.brief_versions on brief_versions.study_id = studies.id
        where studies.id = supplied_study_id and studies.organization_id = supplied_organization_id
            and brief_versions.version = 1 and brief_versions.created_by = supplied_researcher_id
            and brief_versions.brief_json = draft;
        if saved_id is null then
            raise unique_violation;
        end if;
        return jsonb_build_object('studyId', saved_id, 'state', saved_state);
    end if;

    insert into public.brief_versions (study_id, version, brief_json, created_by)
    values (saved_id, 1, draft, supplied_researcher_id);

    insert into public.criteria (study_id, kind, attribute_key, operator, value_json, text)
    select saved_id, criterion->>'kind', criterion->>'attributeKey', criterion->>'operator',
        criterion->'value', criterion->>'text'
    from jsonb_array_elements(predicates) as input(criterion);

    insert into public.guide_questions (study_id, position, text, max_probes)
    select saved_id, position::integer, question, 0
    from jsonb_array_elements_text(draft->'coreQuestions') with ordinality as guide(question, position);

    insert into public.audit_log (entity, entity_id, to_state, actor)
    values ('study', saved_id, saved_state, supplied_researcher_id::text);

    insert into public.events (name, actor_type, study_id, props)
    values ('study.created', 'researcher', saved_id,
        jsonb_build_object('target_completes', (draft->>'targetCompletes')::integer));

    return jsonb_build_object('studyId', saved_id, 'state', saved_state);
end;
$$;

revoke all on function public.create_gate1_study(uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.create_gate1_study(uuid, uuid, uuid, jsonb, jsonb) to service_role;
