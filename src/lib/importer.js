const headerAliases = {
  full_name: ['nombre', 'nombre completo', 'nombre mostrado', 'name', 'full name'],
  role: ['cargo', 'posicion', 'posición', 'nombre posicion', 'nombre posición', 'nombre puesto', 'role'],
  email: ['correo', 'correo corporativo', 'email', 'mail'],
  department_name: ['departamento', 'nombre departamento', 'area', 'área', 'department'],
  manager_name: ['jefe directo', 'jefe', 'manager', 'lider', 'líder'],
  status: ['estado', 'status'],
  department_sort_order: ['orden departamento', 'orden depto'],
  hierarchy_order: ['orden jerarquico', 'orden jerárquico'],
  hierarchy_level: ['nivel jerarquico', 'nivel jerárquico', 'nivel'],
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
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []

  const headers = []
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = clean(cell.value)
  })

  const rows = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record = {}
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber]
      if (key) record[key] = clean(readCellValue(cell.value))
    })
    if (Object.values(record).some(Boolean)) rows.push(record)
  })
  return rows
}

export function mapImportedRows(rows) {
  return rows
    .map((row, index) => {
      const normalized = Object.entries(row).reduce((acc, [key, value]) => {
        acc[normalizeHeader(key)] = clean(value)
        return acc
      }, {})

      const fullName = pick(normalized, 'full_name')

      return {
        sourceRow: index + 2,
        full_name: fullName,
        role: pick(normalized, 'role') || 'Cargo pendiente',
        email: normalizeEmail(pick(normalized, 'email'), fullName),
        department_name: pick(normalized, 'department_name') || 'Departamento pendiente',
        manager_name: pick(normalized, 'manager_name'),
        status: normalizeStatus(pick(normalized, 'status')),
        department_sort_order: Number(pick(normalized, 'department_sort_order') || 999),
        hierarchy_order: Number(pick(normalized, 'hierarchy_order') || 99),
        hierarchy_level: pick(normalized, 'hierarchy_level') || 'Sin nivel',
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

    const key = (row.email || row.full_name).toLowerCase()
    if (importedByKey.has(key)) issues.push(`Duplicado detectado: ${row.full_name || row.email}.`)
    importedByKey.set(key, row)
    importedKeys.add(key)
    if (row.full_name) importedKeys.add(row.full_name.toLowerCase())

    if (!departmentsByName.has(row.department_name.toLowerCase())) newDepartments.push(row.department_name)

    const existing = (row.email && peopleByEmail.get(row.email.toLowerCase())) || peopleByName.get(row.full_name.toLowerCase())
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
    if (row.manager_name) {
      managerChanges.push({ person: row.full_name, after: row.manager_name })
      changedFields.push('jefe directo')
    }
    if (changedFields.length) updatedPeople.push({ row, changedFields })
  }

  const missingPeople = currentPeople.filter((person) => {
    const key = (person.email || person.full_name).toLowerCase()
    const nameKey = person.full_name.toLowerCase()
    return person.status === 'active' && !importedKeys.has(key) && !importedKeys.has(nameKey)
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
