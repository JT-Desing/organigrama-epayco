create extension if not exists http with schema extensions;

do $$
declare
  payload jsonb;
  seed_url text := 'https://raw.githubusercontent.com/JT-Desing/organigrama-epayco/main/src/data/epaycoSeed.json';
begin
  select content::jsonb
  into payload
  from extensions.http_get(seed_url)
  where status = 200;

  if payload is null then
    raise exception 'No fue posible descargar la semilla desde %', seed_url;
  end if;

  insert into public.departments (id, name, parent_id, sort_order, status, updated_at)
  select
    d.id::uuid,
    d.name,
    nullif(d.parent_id, '')::uuid,
    coalesce(d.sort_order, 999),
    coalesce(nullif(d.status, ''), 'active'),
    now()
  from jsonb_to_recordset(payload -> 'departments') as d(
    id text,
    name text,
    parent_id text,
    sort_order integer,
    status text
  )
  on conflict (id) do update set
    name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

  insert into public.people (
    id,
    full_name,
    role,
    email,
    department_id,
    manager_id,
    status,
    department_sort_order,
    hierarchy_order,
    hierarchy_level,
    subarea,
    group_name,
    global_order,
    group_order,
    source_person_id,
    source_parent_id,
    source_row,
    source_pages,
    match_status,
    match_score,
    email_source,
    email_status,
    updated_at
  )
  select
    p.id::uuid,
    p.full_name,
    p.role,
    nullif(lower(p.email), ''),
    nullif(p.department_id, '')::uuid,
    nullif(p.manager_id, '')::uuid,
    coalesce(nullif(p.status, ''), 'active'),
    p.department_sort_order,
    coalesce(p.hierarchy_order, 99),
    p.hierarchy_level,
    p.subarea,
    p.group_name,
    p.global_order,
    p.group_order,
    p.source_person_id,
    p.source_parent_id,
    p.source_row,
    p.source_pages,
    p.match_status,
    p.match_score,
    p.email_source,
    p.email_status,
    coalesce(nullif(p.updated_at, '')::timestamptz, now())
  from jsonb_to_recordset(payload -> 'people') as p(
    id text,
    full_name text,
    role text,
    email text,
    department_id text,
    manager_id text,
    status text,
    updated_at text,
    department_sort_order integer,
    hierarchy_order integer,
    hierarchy_level text,
    subarea text,
    group_name text,
    global_order integer,
    group_order integer,
    source_person_id text,
    source_parent_id text,
    source_row text,
    source_pages text,
    match_status text,
    match_score numeric,
    email_source text,
    email_status text
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    email = excluded.email,
    department_id = excluded.department_id,
    manager_id = excluded.manager_id,
    status = excluded.status,
    department_sort_order = excluded.department_sort_order,
    hierarchy_order = excluded.hierarchy_order,
    hierarchy_level = excluded.hierarchy_level,
    subarea = excluded.subarea,
    group_name = excluded.group_name,
    global_order = excluded.global_order,
    group_order = excluded.group_order,
    source_person_id = excluded.source_person_id,
    source_parent_id = excluded.source_parent_id,
    source_row = excluded.source_row,
    source_pages = excluded.source_pages,
    match_status = excluded.match_status,
    match_score = excluded.match_score,
    email_source = excluded.email_source,
    email_status = excluded.email_status,
    updated_at = excluded.updated_at;

  insert into public.change_history (actor, action, target)
  values (
    'sistema',
    'Carga inicial Supabase',
    (select count(*) from jsonb_array_elements(payload -> 'people')) || ' personas / ' ||
    (select count(*) from jsonb_array_elements(payload -> 'departments')) || ' departamentos'
  );
end $$;
