create extension if not exists http with schema extensions;

create or replace function public.seed_uuid(input text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(input), 1, 8) || '-' ||
    substr(md5(input), 9, 4) || '-' ||
    '5' || substr(md5(input), 14, 3) || '-' ||
    'a' || substr(md5(input), 18, 3) || '-' ||
    substr(md5(input), 21, 12)
  )::uuid;
$$;

do $$
declare
  payload jsonb;
  seed_url text := 'https://raw.githubusercontent.com/JT-Desing/organigrama-epayco/main/src/data/ipqSeed.json';
begin
  select content::jsonb
  into payload
  from extensions.http_get(seed_url)
  where status = 200;

  if payload is null then
    raise exception 'No fue posible descargar la semilla desde %', seed_url;
  end if;

  insert into public.departments (id, name, parent_id, sort_order, status)
  select
    public.seed_uuid('department:' || d.id),
    d.name,
    case
      when nullif(d.parent_id, '') is null then null
      else public.seed_uuid('department:' || d.parent_id)
    end,
    coalesce(d.sort_order, 999),
    coalesce(nullif(d.status, ''), 'active')
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
    rule_applied,
    source_row,
    updated_at
  )
  select
    public.seed_uuid('person:' || p.id),
    p.full_name,
    p.role,
    nullif(lower(p.email), ''),
    public.seed_uuid('department:' || p.department_id),
    null,
    coalesce(nullif(p.status, ''), 'active'),
    p.department_sort_order,
    coalesce(p.hierarchy_order, 99),
    p.hierarchy_level,
    p.rule_applied,
    p.source_row,
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
    rule_applied text,
    source_row text
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    role = excluded.role,
    email = excluded.email,
    department_id = excluded.department_id,
    status = excluded.status,
    department_sort_order = excluded.department_sort_order,
    hierarchy_order = excluded.hierarchy_order,
    hierarchy_level = excluded.hierarchy_level,
    rule_applied = excluded.rule_applied,
    source_row = excluded.source_row,
    updated_at = excluded.updated_at;

  update public.people as target
  set manager_id = case
    when nullif(p.manager_id, '') is null then null
    else public.seed_uuid('person:' || p.manager_id)
  end
  from jsonb_to_recordset(payload -> 'people') as p(id text, manager_id text)
  where target.id = public.seed_uuid('person:' || p.id);

  insert into public.change_history (actor, action, target)
  values (
    'sistema',
    'Carga inicial Supabase',
    (select count(*) from jsonb_array_elements(payload -> 'people')) || ' personas / ' ||
    (select count(*) from jsonb_array_elements(payload -> 'departments')) || ' departamentos'
  );
end $$;

drop function if exists public.seed_uuid(text);
