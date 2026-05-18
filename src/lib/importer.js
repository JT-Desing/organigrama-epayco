const headerAliases = {
  full_name: ['nombre', 'nombre completo', 'nombre mostrado', 'nombre base', 'name', 'full name'],
  role: ['cargo', 'cargo base', 'posicion', 'nombre posicion', 'nombre puesto', 'cargo o tipo', 'role'],
  email: ['correo', 'correo corporativo', 'correo electronico', 'email', 'mail'],
  department_name: ['departamento', 'nombre departamento', 'departamento pdf', 'departamento base', 'area', 'department'],
  manager_name: ['jefe directo', 'jefe', 'manager', 'lider', 'reporta a'],
  status: ['estado', 'status'],
  department_sort_order: ['orden departamento', 'orden depto'],
  hierarchy_order: ['nivel jerarquico', 'orden jerarquico', 'nivel', 'orden'],
  hierarchy_level: ['nivel nombre', 'nivel jerarquico texto', 'nivel rol'],
  subarea: ['subarea pdf', 'subarea'],
  group_name: ['grupo pdf', 'grupo'],
  global_order: ['orden global'],
  group_order: ['orden en grupo'],
  source_person_id: ['persona id sugerido', 'base id', 'id'],
  source_parent_id: ['parent id sugerido', 'parent id'],
  source_pages: ['paginas'],
  match_status: ['match estado'],
  match_score: ['score match'],
  email_source: ['fuente correo'],
  email_status: ['estado correo'],
}

const CORPORATE_EMAIL_DOMAIN = 'epayco.com'

export function createEmptyPerson() {
  return {
    id: '',
    full_name: '',
    role: '',
    email: '',
    department_id: '',
    manager_id: null,
    status: 'active',
    hierarchy_order: 99,
    hierarchy_level: '',
    subarea: '',
    group_name: '',
    updated_at: new Date().toISOString(),
  }
}

export async function parseWorkbookFile(file) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const { default: Papa } = await import('papaparse')
    const text = await file.text()
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
    if (parsed.errors.length) throw new Error(parsed.errors[0].message)
    return parsed.data
  }

  const { default: ExcelJS } = await import('exceljs')
  const data = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data)
  const worksheet = findWorksheet(workbook)
  if (!worksheet) return []

  const rows = readWorksheetRows(worksheet)
  const emailRows = readWorksheetRows(workbook.getWorksheet('Correos_Extraidos'))
  if (!emailRows.length) return rows

  const emailByName = emailRows.reduce((map, row) => {
    const normalized = normalizeRawRow(row)
    const name = pick(normalized, 'full_name')
    const email = pick(normalized, 'email')
    if (name && email) map.set(nameKey(name), email)
    return map
  }, new Map())

  return rows.map((row) => {
    const normalized = normalizeRawRow(row)
    const fullName = pick(normalized, 'full_name')
    const email = pick(normalized, 'email')
    if (email || !fullName) return row
    return { ...row, 'Correo electrónico': emailByName.get(nameKey(fullName)) || '' }
  })
}

export function mapImportedRows(rows) {
  return rows
    .map((row, index) => {
      const normalized = normalizeRawRow(row)
      const fullName = pick(normalized, 'full_name')
      const hierarchyOrder = Number(pick(normalized, 'hierarchy_order') || 99)
      const subarea = pick(normalized, 'subarea')
      const groupName = pick(normalized, 'group_name')

      return {
        sourceRow: row.__rowNumber || index + 2,
        full_name: fullName,
        role: pick(normalized, 'role') || 'Cargo pendiente',
        email: normalizeEmail(pick(normalized, 'email'), fullName),
        department_name: pick(normalized, 'department_name') || 'Departamento pendiente',
        manager_name: pick(normalized, 'manager_name'),
        status: normalizeStatus(pick(normalized, 'status')),
        department_sort_order: Number(pick(normalized, 'department_sort_order') || 999),
        hierarchy_order: hierarchyOrder,
        hierarchy_level: pick(normalized, 'hierarchy_level') || groupName || subarea || `Nivel ${hierarchyOrder}`,
        subarea,
        group_name: groupName,
        global_order: Number(pick(normalized, 'global_order') || index + 1),
        group_order: Number(pick(normalized, 'group_order') || index + 1),
        source_person_id: pick(normalized, 'source_person_id'),
        source_parent_id: pick(normalized, 'source_parent_id'),
        source_pages: pick(normalized, 'source_pages'),
        match_status: pick(normalized, 'match_status'),
        match_score: nullableNumber(pick(normalized, 'match_score')),
        email_source: pick(normalized, 'email_source'),
        email_status: pick(normalized, 'email_status'),
      }
    })
    .filter((row) => row.full_name || row.email || row.department_name !== 'Departamento pendiente')
}

export function buildChangeSet(importedRows, currentPeople, currentDepartments) {
  const issues = []
  const importedByKey = new Map()
  const departmentsByName = new Map(currentDepartments.map((item) => [item.name.toLowerCase(), item]))
  const peopleByEmail = new Map(currentPeople.filter((item) => item.email).map((item) => [item.email.toLowerCase(), item]))
  const peopleByName = new Map(currentPeople.map((item) => [item.full_name.toLowerCase(), item]))
  const peopleBySourceId = new Map(
    currentPeople.filter((item) => item.source_person_id).map((item) => [item.source_person_id, item]),
  )
  const importedKeys = new Set()

  const newPeople = []
  const updatedPeople = []
  const roleChanges = []
  const departmentChanges = []
  const managerChanges = []
  const newDepartments = []

  for (const row of importedRows) {
    if (!row.full_name) issues.push(`Fila ${row.sourceRow}: falta nombre.`)
    if (!row.department_name) issues.push(`Fila ${row.sourceRow}: falta departamento.`)
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) issues.push(`Fila ${row.sourceRow}: correo invalido.`)

    const key = (row.source_person_id || row.email || row.full_name).toLowerCase()
    if (importedByKey.has(key)) issues.push(`Duplicado detectado: ${row.full_name || row.email}.`)
    importedByKey.set(key, row)
    importedKeys.add(key)
    if (row.email) importedKeys.add(row.email.toLowerCase())
    if (row.full_name) importedKeys.add(row.full_name.toLowerCase())

    if (!departmentsByName.has(row.department_name.toLowerCase())) newDepartments.push(row.department_name)

    const existing =
      (row.source_person_id && peopleBySourceId.get(row.source_person_id)) ||
      (row.email && peopleByEmail.get(row.email.toLowerCase())) ||
      peopleByName.get(row.full_name.toLowerCase())
    if (!existing) {
      newPeople.push(row)
      continue
    }

    const department = departmentsByName.get(row.department_name.toLowerCase())
    const changedFields = []
    if (clean(existing.role).toLowerCase() !== clean(row.role).toLowerCase()) {
      roleChanges.push({ before: existing.role, after: row.role, person: row.full_name })
      changedFields.push('cargo')
    }
    if (department && existing.department_id !== department.id) {
      departmentChanges.push({ person: row.full_name, after: row.department_name })
      changedFields.push('departamento')
    }
    if (row.manager_name || row.source_parent_id) {
      managerChanges.push({ person: row.full_name, after: row.manager_name || row.source_parent_id })
      changedFields.push('jefe directo')
    }
    if (changedFields.length) updatedPeople.push({ row, changedFields })
  }

  const missingPeople = currentPeople.filter((person) => {
    const sourceKey = person.source_person_id?.toLowerCase()
    const key = (person.email || person.full_name).toLowerCase()
    const nameKeyValue = person.full_name.toLowerCase()
    return (
      person.status === 'active' &&
      (!sourceKey || !importedKeys.has(sourceKey)) &&
      !importedKeys.has(key) &&
      !importedKeys.has(nameKeyValue)
    )
  })

  return {
    newPeople,
    updatedPeople,
    missingPeople,
    newDepartments: [...new Set(newDepartments)],
    roleChanges,
    departmentChanges,
    managerChanges,
    issues,
  }
}

export function summarizeChanges(changes) {
  return {
    newPeople: changes.newPeople.length,
    updatedPeople: changes.updatedPeople.length,
    missingPeople: changes.missingPeople.length,
    newDepartments: changes.newDepartments.length,
    roleChanges: changes.roleChanges.length,
    departmentChanges: changes.departmentChanges.length,
    managerChanges: changes.managerChanges.length,
    issues: changes.issues.length,
  }
}

function findWorksheet(workbook) {
  return (
    workbook.getWorksheet('BD_Organizada_PDF') ||
    workbook.worksheets.find((worksheet) => {
      const headers = []
      worksheet.getRow(1).eachCell((cell) => headers.push(normalizeHeader(readCellValue(cell.value))))
      return headers.includes('departamento pdf') && headers.includes('nombre')
    }) ||
    workbook.worksheets[0]
  )
}

function readWorksheetRows(worksheet) {
  if (!worksheet) return []

  const headers = []
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = clean(readCellValue(cell.value))
  })

  const rows = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record = { __rowNumber: rowNumber }
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber]
      if (key) record[key] = clean(readCellValue(cell.value))
    })
    if (Object.entries(record).some(([key, value]) => key !== '__rowNumber' && Boolean(value))) rows.push(record)
  })
  return rows
}

function normalizeRawRow(row) {
  return Object.entries(row).reduce((acc, [key, value]) => {
    if (key === '__rowNumber') return acc
    acc[normalizeHeader(key)] = clean(value)
    return acc
  }, {})
}

function pick(row, canonicalKey) {
  for (const alias of headerAliases[canonicalKey]) {
    const value = row[normalizeHeader(alias)]
    if (value) return value
  }
  return ''
}

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeEmail(value, fallbackName) {
  const raw = clean(value).toLowerCase()
  if (!raw && fallbackName) return `${slugEmailName(fallbackName)}@${CORPORATE_EMAIL_DOMAIN}`
  if (!raw) return ''

  const [localPart] = raw.split('@')
  const normalizedLocalPart = slugEmailName(localPart)
  if (!normalizedLocalPart) return ''
  return `${normalizedLocalPart}@${CORPORATE_EMAIL_DOMAIN}`
}

function slugEmailName(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function nameKey(value) {
  return slugEmailName(value).replace(/\./g, '')
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

function normalizeHeader(header) {
  return clean(header)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeStatus(value) {
  const status = clean(value).toLowerCase()
  if (['inactivo', 'inactive', 'retirado', 'baja'].includes(status)) return 'inactive'
  return 'active'
}

function nullableNumber(value) {
  const number = Number(clean(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}
