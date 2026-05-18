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

  create temp table incoming_departments on commit drop as
  select
    d.id::uuid as seed_id,
    d.name,
    nullif(d.parent_id, '')::uuid as parent_id,
    coalesce(d.sort_order, 999) as sort_order,
    coalesce(nullif(d.status, ''), 'active') as status
  from jsonb_to_recordset(payload -> 'departments') as d(
    id text,
    name text,
    parent_id text,
    sort_order integer,
    status text
  );

  insert into public.departments (id, name, parent_id, sort_order, status, updated_at)
  select seed_id, name, parent_id, sort_order, status, now()
  from incoming_departments
  on conflict (name) do update set
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

  update public.departments
  set status = 'inactive',
      updated_at = now()
  where lower(name) not in (select lower(name) from incoming_departments);

  create temp table incoming_people on commit drop as
  select
    p.id::uuid as id,
    p.full_name,
    p.role,
    nullif(lower(p.email), '') as email,
    p.department_id::uuid as seed_department_id,
    coalesce(nullif(p.status, ''), 'active') as status,
    p.department_sort_order,
    coalesce(p.hierarchy_order, 99) as hierarchy_order,
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
    coalesce(nullif(p.updated_at, '')::timestamptz, now()) as updated_at
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
  );

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
    incoming_people.id,
    incoming_people.full_name,
    incoming_people.role,
    incoming_people.email,
    departments.id,
    null,
    incoming_people.status,
    incoming_people.department_sort_order,
    incoming_people.hierarchy_order,
    incoming_people.hierarchy_level,
    incoming_people.subarea,
    incoming_people.group_name,
    incoming_people.global_order,
    incoming_people.group_order,
    incoming_people.source_person_id,
    incoming_people.source_parent_id,
    incoming_people.source_row,
    incoming_people.source_pages,
    incoming_people.match_status,
    incoming_people.match_score,
    incoming_people.email_source,
    incoming_people.email_status,
    incoming_people.updated_at
  from incoming_people
  left join incoming_departments seed_departments
    on seed_departments.seed_id = incoming_people.seed_department_id
  left join public.departments departments
    on lower(departments.name) = lower(seed_departments.name)
  on conflict (email) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    department_id = excluded.department_id,
    manager_id = null,
    status = 'active',
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

  update public.people people
  set manager_id = managers.id,
      updated_at = now()
  from public.people managers
  where people.source_parent_id is not null
    and people.source_parent_id <> ''
    and managers.source_person_id = people.source_parent_id;

  update public.people
  set manager_id = null,
      updated_at = now()
  where source_parent_id is null
     or source_parent_id = '';

  update public.people
  set status = 'inactive',
      updated_at = now()
  where coalesce(source_person_id, '') not in (select source_person_id from incoming_people)
    and lower(coalesce(email, '')) not in (select lower(email) from incoming_people where email is not null);

  insert into public.change_history (actor, action, target, after_data)
  values (
    'sistema',
    'Carga inicial Supabase',
    (select count(*) from incoming_people) || ' personas / ' ||
    (select count(*) from incoming_departments) || ' departamentos',
    jsonb_build_object('source', seed_url)
  );
end $$;
