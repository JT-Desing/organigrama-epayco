import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'

const inputPath = process.argv[2]

if (!inputPath) {
  console.error('Usage: node scripts/generate-master-data.mjs <master-xlsx-path>')
  process.exit(1)
}

const outputSeedPath = path.resolve('src/data/epaycoSeed.json')
const outputSqlPath = path.resolve('supabase/seed_from_master.sql')
const corporateDomain = 'epayco.com'

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(inputPath)

const mainSheet = workbook.getWorksheet('BD_Organizada_PDF')
if (!mainSheet) {
  throw new Error('The workbook must include the BD_Organizada_PDF sheet.')
}

const mainRows = readWorksheetRows(mainSheet)
const emailRows = readWorksheetRows(workbook.getWorksheet('Correos_Extraidos'))
const emailByName = buildEmailIndex(emailRows)

const departmentMeta = new Map()
for (const row of mainRows) {
  const departmentName = field(row, 'departamento pdf')
  const personName = field(row, 'nombre')
  if (!departmentName || !personName) continue

  const sortOrder = toNumber(field(row, 'orden departamento'), departmentMeta.size + 1)
  const current = departmentMeta.get(departmentName)
  if (!current || sortOrder < current.sort_order) {
    departmentMeta.set(departmentName, {
      id: uuidFrom(`department:${departmentName}`),
      name: departmentName,
      parent_id: null,
      sort_order: sortOrder,
      status: 'active',
    })
  }
}

const departments = [...departmentMeta.values()].sort(
  (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
)

const sourceIdToPersonId = new Map()
const peopleDrafts = []
const seenEmails = new Map()

for (const row of mainRows) {
  const fullName = field(row, 'nombre') || field(row, 'nombre base')
  const departmentName = field(row, 'departamento pdf') || field(row, 'departamento base')
  if (!fullName || !departmentName) continue

  const sourcePersonId = field(row, 'persona id sugerido') || `per_${slug(fullName)}`
  const sourceParentId = field(row, 'parent id sugerido')
  const department = departmentMeta.get(departmentName)
  const emailFromSheet = field(row, 'correo electronico') || emailByName.get(nameKey(fullName))
  const email = normalizeEmail(emailFromSheet, fullName)
  const hierarchyOrder = toNumber(field(row, 'nivel jerarquico'), 99)
  const subarea = field(row, 'subarea pdf')
  const groupName = field(row, 'grupo pdf')

  if (seenEmails.has(email)) {
    console.warn(`Duplicate email detected: ${email} (${fullName} and ${seenEmails.get(email)})`)
  }
  seenEmails.set(email, fullName)

  const person = {
    id: uuidFrom(`person:${sourcePersonId}`),
    full_name: fullName,
    role: field(row, 'cargo') || field(row, 'cargo base') || 'Cargo pendiente',
    email,
    department_id: department?.id || null,
    manager_id: null,
    status: 'active',
    department_sort_order: department?.sort_order || toNumber(field(row, 'orden departamento'), 999),
    hierarchy_order: hierarchyOrder,
    hierarchy_level: groupName || subarea || `Nivel ${hierarchyOrder}`,
    subarea,
    group_name: groupName,
    global_order: toNumber(field(row, 'orden global'), 999),
    group_order: toNumber(field(row, 'orden en grupo'), 999),
    source_person_id: sourcePersonId,
    source_parent_id: sourceParentId || null,
    source_row: String(row.__rowNumber),
    source_pages: field(row, 'paginas'),
    match_status: field(row, 'match estado'),
    match_score: nullableNumber(field(row, 'score match')),
    email_source: field(row, 'fuente correo'),
    email_status: field(row, 'estado correo'),
    updated_at: new Date().toISOString(),
  }

  sourceIdToPersonId.set(sourcePersonId, person.id)
  peopleDrafts.push(person)
}

const people = peopleDrafts
  .map((person) => ({
    ...person,
    manager_id: person.source_parent_id ? sourceIdToPersonId.get(person.source_parent_id) || null : null,
  }))
  .sort(
    (a, b) =>
      a.department_sort_order - b.department_sort_order ||
      a.global_order - b.global_order ||
      a.full_name.localeCompare(b.full_name),
  )

const seed = { departments, people }
await fs.writeFile(outputSeedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')
await fs.writeFile(outputSqlPath, buildSqlSeed(departments, people), 'utf8')

console.log(`Generated ${departments.length} departments and ${people.length} people.`)
console.log(outputSeedPath)
console.log(outputSqlPath)

function readWorksheetRows(worksheet) {
  if (!worksheet) return []

  const headers = []
  worksheet.getRow(1).eachCell((cell, columnNumber) => {
    headers[columnNumber] = normalizeHeader(readCellValue(cell.value))
  })

  const rows = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record = { __rowNumber: rowNumber }
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = headers[columnNumber]
      if (key) record[key] = clean(readCellValue(cell.value))
    })
    if (Object.entries(record).some(([key, value]) => key !== '__rowNumber' && Boolean(value))) rows.push(record)
  })

  return rows
}

function buildEmailIndex(rows) {
  const index = new Map()
  for (const row of rows) {
    const name = field(row, 'nombre mostrado')
    const email = field(row, 'correo electronico')
    if (name && email) index.set(nameKey(name), email)
  }
  return index
}

function buildSqlSeed(departments, people) {
  const departmentNames = departments.map((department) => department.name)
  const peopleEmails = people.map((person) => person.email).filter(Boolean)
  const personSourceIds = people.map((person) => person.source_person_id).filter(Boolean)
  const departmentValues = departments
    .map(
      (department) =>
        `(${sqlText(department.id)}, ${sqlText(department.name)}, ${sqlNumber(department.sort_order)}, ${sqlText(department.status)})`,
    )
    .join(',\n    ')
  const peopleValues = people
    .map(
      (person) =>
        `(${sqlText(person.id)}, ${sqlText(person.full_name)}, ${sqlText(person.role)}, ${sqlText(person.email)}, ${sqlText(person.department_name || departmentById(departments, person.department_id)?.name)}, ${sqlText(person.status)}, ${sqlNumber(person.department_sort_order)}, ${sqlNumber(person.hierarchy_order)}, ${sqlText(person.hierarchy_level)}, ${sqlText(person.subarea)}, ${sqlText(person.group_name)}, ${sqlNumber(person.global_order)}, ${sqlNumber(person.group_order)}, ${sqlText(person.source_person_id)}, ${sqlText(person.source_parent_id)}, ${sqlText(person.source_row)}, ${sqlText(person.source_pages)}, ${sqlText(person.match_status)}, ${sqlNumber(person.match_score)}, ${sqlText(person.email_source)}, ${sqlText(person.email_status)})`,
    )
    .join(',\n    ')

  return `begin;

with incoming_departments(id, name, sort_order, status) as (
  values
    ${departmentValues}
)
insert into public.departments (id, name, sort_order, status, updated_at)
select id::uuid, name, sort_order, status, now()
from incoming_departments
on conflict (name) do update
set sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

update public.departments
set status = 'inactive',
    updated_at = now()
where lower(name) not in (${departmentNames.map((name) => sqlText(name.toLowerCase())).join(', ')});

with incoming_people(
  id,
  full_name,
  role,
  email,
  department_name,
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
  email_status
) as (
  values
    ${peopleValues}
),
prepared_people as (
  select
    incoming_people.id::uuid,
    incoming_people.full_name,
    incoming_people.role,
    incoming_people.email,
    departments.id as department_id,
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
    incoming_people.email_status
  from incoming_people
  left join public.departments departments
    on lower(departments.name) = lower(incoming_people.department_name)
)
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
  id,
  full_name,
  role,
  email,
  department_id,
  null,
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
  now()
from prepared_people
on conflict (email) do update
set full_name = excluded.full_name,
    role = excluded.role,
    department_id = excluded.department_id,
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
    updated_at = now();

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
where coalesce(source_person_id, '') not in (${personSourceIds.map(sqlText).join(', ')})
  and lower(coalesce(email, '')) not in (${peopleEmails.map((email) => sqlText(email.toLowerCase())).join(', ')});

insert into public.change_history (actor, action, target, after_data)
values (
  'codex',
  'Carga maestra ePayco',
  ${sqlText(`${people.length} personas / ${departments.length} departamentos`)},
  jsonb_build_object('source', 'ORGANIGRAMA_EPAYCO_MAESTRO_COMPLETO_FINAL.xlsx')
);

commit;
`
}

function departmentById(departments, id) {
  return departments.find((department) => department.id === id)
}

function field(row, key) {
  return clean(row[normalizeHeader(key)])
}

function readCellValue(value) {
  if (value && typeof value === 'object') {
    if ('text' in value) return value.text
    if ('result' in value) return value.result
    if ('richText' in value) return value.richText.map((item) => item.text).join('')
    if ('hyperlink' in value) return value.text || value.hyperlink
  }
  return value
}

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeEmail(value, fallbackName) {
  const raw = clean(value).toLowerCase()
  const fallback = `${slug(fallbackName)}@${corporateDomain}`
  if (!raw) return fallback

  const [localPart] = raw.split('@')
  const normalizedLocalPart = slug(localPart)
  return normalizedLocalPart ? `${normalizedLocalPart}@${corporateDomain}` : fallback
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function nameKey(value) {
  return slug(value).replace(/\./g, '')
}

function uuidFrom(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function toNumber(value, fallback = 0) {
  const number = Number(clean(value).replace(',', '.'))
  return Number.isFinite(number) ? number : fallback
}

function nullableNumber(value) {
  const number = Number(clean(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function sqlText(value) {
  if (value === null || value === undefined || value === '') return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlNumber(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : 'null'
}
