const CARD_WIDTH = 250
const CARD_GAP = 34
const ROW_GAP = 150
const LEVEL_GAP = 78
const HEADER_WIDTH = 520
const HEADER_HEIGHT = 96
const COMPANY_WIDTH = 420
const BLOCK_GAP_X = 150
const BLOCK_GAP_Y = 150
const TOP = 56
const DEPARTMENT_TOP = TOP + 190
const MAX_PERSON_COLUMNS = 4

export function normalizeCatalog(people, departments) {
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  const normalizedDepartments = departments
    .map((department, index) => ({
      ...department,
      sort_order: department.sort_order ?? index + 1,
      status: department.status || 'active',
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const normalizedPeople = people.map((person) => {
    const department = departmentById.get(person.department_id)
    return {
      ...person,
      full_name: person.full_name || person.name || 'Sin nombre',
      role: person.role || person.cargo || 'Cargo pendiente',
      status: person.status || 'active',
      department_name: department?.name || 'Departamento pendiente',
      hierarchy_order: Number(person.hierarchy_order || 99),
      hierarchy_level: person.hierarchy_level || 'Sin nivel',
      department_sort_order: Number(person.department_sort_order || department?.sort_order || 999),
    }
  })

  return { people: normalizedPeople, departments: normalizedDepartments }
}

export function buildFlowModel({ departments, people, onOpenPerson, onToggleDepartment, expandedDepartmentIds }) {
  const nodes = []
  const edges = []
  const focusPoints = {}
  const activeDepartments = departments.filter((department) => department.status !== 'inactive')
  const expanded = expandedDepartmentIds || new Set()
  const peopleByDepartment = groupBy(people, 'department_id')
  const activePeopleCount = people.filter((person) => person.status === 'active').length
  const departmentLayouts = []
  const viewportColumns = 2
  let cursorX = 0
  let cursorY = DEPARTMENT_TOP
  let rowMaxHeight = 0

  const preparedDepartments = activeDepartments.map((department) => {
    const departmentPeople = (peopleByDepartment.get(department.id) || []).sort(
      (a, b) => a.hierarchy_order - b.hierarchy_order || a.full_name.localeCompare(b.full_name),
    )
    const isExpanded = expanded.has(department.id)
    const blockWidth = getDepartmentBlockWidth(departmentPeople, isExpanded)
    const blockHeight = getDepartmentBlockHeight(departmentPeople, isExpanded)

    return {
      department,
      departmentPeople,
      isExpanded,
      blockWidth,
      blockHeight,
    }
  })

  preparedDepartments.forEach((layout, index) => {
    if (index > 0 && index % viewportColumns === 0) {
      cursorX = 0
      cursorY += rowMaxHeight + BLOCK_GAP_Y
      rowMaxHeight = 0
    }

    departmentLayouts.push({
      ...layout,
      x: cursorX,
      y: cursorY,
    })

    cursorX += layout.blockWidth + BLOCK_GAP_X
    rowMaxHeight = Math.max(rowMaxHeight, layout.blockHeight)
  })

  const totalWidth = Math.max(
    COMPANY_WIDTH,
    ...departmentLayouts.map((layout) => layout.x + layout.blockWidth),
  )
  const companyX = totalWidth / 2 - COMPANY_WIDTH / 2

  nodes.push({
    id: 'company-epayco',
    type: 'company',
    position: { x: companyX, y: TOP },
    data: {
      name: 'ePayco',
      count: activePeopleCount,
      departments: activeDepartments.length,
    },
    draggable: false,
  })

  departmentLayouts.forEach(({ department, departmentPeople, isExpanded, blockHeight, blockWidth, x, y }) => {
    const departmentX = x + blockWidth / 2 - HEADER_WIDTH / 2

    focusPoints[department.id] = {
      x: x + blockWidth / 2,
      y: y + Math.min(blockHeight / 2, 420),
    }

    nodes.push({
      id: `department-${department.id}`,
      type: 'department',
      position: { x: departmentX, y },
      data: {
        ...department,
        count: departmentPeople.filter((person) => person.status === 'active').length,
        expanded: isExpanded,
        onToggle: () => onToggleDepartment(department.id),
      },
      draggable: true,
    })

    edges.push(createEdge(`company-${department.id}`, 'company-epayco', `department-${department.id}`, '#5b7fa0', 1.15))

    if (isExpanded) {
      buildDepartmentPeople({
        nodes,
        edges,
        department,
        people: departmentPeople,
        origin: { x, y: y + HEADER_HEIGHT + 64, width: blockWidth },
        onOpenPerson,
      })
    }
  })

  return { nodes, edges, focusPoints }
}

function buildDepartmentPeople({ nodes, edges, department, people, origin, onOpenPerson }) {
  const peopleByLevel = groupBy(people, 'hierarchy_order')
  const levels = [...peopleByLevel.keys()].sort((a, b) => Number(a) - Number(b))
  let cursorY = origin.y
  let previousLevelPeople = []

  levels.forEach((level) => {
    const levelPeople = peopleByLevel.get(level)
    const columns = getColumnCount(levelPeople.length)
    const levelWidth = columns * CARD_WIDTH + (columns - 1) * CARD_GAP
    const startX = origin.x + (origin.width - levelWidth) / 2
    const labelId = `level-${department.id}-${level}`

    nodes.push({
      id: labelId,
      type: 'level',
      position: { x: origin.x, y: cursorY - 40 },
      data: { label: levelPeople[0]?.hierarchy_level || `Nivel ${level}` },
      selectable: false,
      draggable: false,
      style: { width: origin.width },
    })

    levelPeople.forEach((person, personIndex) => {
      const col = personIndex % columns
      const row = Math.floor(personIndex / columns)
      const personNodeId = `person-${person.id}`
      const position = {
        x: startX + col * (CARD_WIDTH + CARD_GAP),
        y: cursorY + row * ROW_GAP,
      }

      nodes.push({
        id: personNodeId,
        type: 'person',
        position,
        data: { ...person, onOpen: () => onOpenPerson(person) },
      })

      if (previousLevelPeople.length > 0) {
        const parent = previousLevelPeople[personIndex % previousLevelPeople.length]
        edges.push(createEdge(`visual-${parent.id}-${person.id}`, `person-${parent.id}`, personNodeId, '#0e7490'))
      } else {
        edges.push(createEdge(`department-${department.id}-${person.id}`, `department-${department.id}`, personNodeId, '#b7dbe2'))
      }
    })

    previousLevelPeople = levelPeople
    cursorY += Math.ceil(levelPeople.length / columns) * ROW_GAP + LEVEL_GAP
  })
}

function createEdge(id, source, target, stroke, strokeWidth = 1.35) {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    style: { stroke, strokeWidth },
  }
}

function getDepartmentBlockWidth(people, isExpanded) {
  if (!isExpanded) return HEADER_WIDTH

  const peopleByLevel = groupBy(people, 'hierarchy_order')
  const widestLevel = Math.max(
    1,
    ...[...peopleByLevel.values()].map((levelPeople) => getColumnCount(levelPeople.length)),
  )

  const peopleWidth = widestLevel * CARD_WIDTH + (widestLevel - 1) * CARD_GAP
  return Math.max(HEADER_WIDTH, peopleWidth)
}

function getDepartmentBlockHeight(people, isExpanded) {
  if (!isExpanded) return HEADER_HEIGHT
  const peopleByLevel = groupBy(people, 'hierarchy_order')
  const peopleHeight = [...peopleByLevel.values()].reduce((height, levelPeople) => {
    const columns = getColumnCount(levelPeople.length)
    return height + Math.ceil(levelPeople.length / columns) * ROW_GAP + LEVEL_GAP
  }, 0)
  return HEADER_HEIGHT + 64 + peopleHeight
}

function getColumnCount(count) {
  if (count <= 1) return 1
  if (count <= MAX_PERSON_COLUMNS) return count
  return MAX_PERSON_COLUMNS
}

function groupBy(items, key) {
  return items.reduce((map, item) => {
    const value = item[key]
    if (!map.has(value)) map.set(value, [])
    map.get(value).push(item)
    return map
  }, new Map())
}
