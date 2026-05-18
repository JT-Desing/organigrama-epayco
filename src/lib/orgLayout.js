const CARD_WIDTH = 260
const CARD_GAP = 32
const ROW_GAP = 158
const LEVEL_GAP = 92
const HEADER_WIDTH = 620
const HEADER_HEIGHT = 104
const COMPANY_WIDTH = 460
const BLOCK_GAP_X = 110
const BLOCK_GAP_Y = 148
const TOP = 56
const DEPARTMENT_TOP = TOP + 184

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
  const departmentColumns = 3
  const totalWidth = departmentColumns * HEADER_WIDTH + (departmentColumns - 1) * BLOCK_GAP_X
  const companyX = totalWidth / 2 - COMPANY_WIDTH / 2
  const activePeopleCount = people.filter((person) => person.status === 'active').length
  const departmentLayouts = []
  let rowY = DEPARTMENT_TOP

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

  for (let index = 0; index < activeDepartments.length; index += departmentColumns) {
    const rowDepartments = activeDepartments.slice(index, index + departmentColumns)
    const rowLayouts = rowDepartments.map((department, columnIndex) => {
      const departmentPeople = (peopleByDepartment.get(department.id) || []).sort(
        (a, b) => a.hierarchy_order - b.hierarchy_order || a.full_name.localeCompare(b.full_name),
      )
      const isExpanded = expanded.has(department.id)
      const blockHeight = getDepartmentBlockHeight(departmentPeople, isExpanded)

      return {
        department,
        departmentPeople,
        isExpanded,
        blockHeight,
        x: columnIndex * (HEADER_WIDTH + BLOCK_GAP_X),
        y: rowY,
      }
    })

    departmentLayouts.push(...rowLayouts)
    rowY += Math.max(...rowLayouts.map((layout) => layout.blockHeight)) + BLOCK_GAP_Y
  }

  departmentLayouts.forEach(({ department, departmentPeople, isExpanded, blockHeight, x, y }) => {
    focusPoints[department.id] = {
      x: x + HEADER_WIDTH / 2,
      y: y + (isExpanded ? Math.min(blockHeight / 2, 520) : HEADER_HEIGHT / 2),
      zoom: isExpanded ? 0.66 : 0.82,
    }

    if (isExpanded) {
      nodes.push({
        id: `frame-${department.id}`,
        type: 'departmentFrame',
        position: { x: x - 30, y: y - 20 },
        data: {
          width: HEADER_WIDTH + 60,
          height: blockHeight + 52,
        },
        draggable: false,
        selectable: false,
        zIndex: 0,
      })
    }

    nodes.push({
      id: `department-${department.id}`,
      type: 'department',
      position: { x, y },
      data: {
        ...department,
        count: departmentPeople.filter((person) => person.status === 'active').length,
        expanded: isExpanded,
        onToggle: () => onToggleDepartment(department.id),
      },
      draggable: false,
      zIndex: 3,
    })

    if (isExpanded) {
      edges.push(createEdge(`company-${department.id}`, 'company-epayco', `department-${department.id}`, '#5b7fa0', 1.15))
      buildDepartmentPeople({
        nodes,
        edges,
        department,
        people: departmentPeople,
        origin: { x, y: y + HEADER_HEIGHT + 46 },
        onOpenPerson,
      })
    }

  })

  return {
    nodes,
    edges,
    focusPoints,
    overview: {
      x: totalWidth / 2,
      y: TOP + Math.max(rowY - TOP, 760) / 2,
      zoom: 0.48,
    },
  }
}

function buildDepartmentPeople({ nodes, edges, department, people, origin, onOpenPerson }) {
  const peopleByLevel = groupBy(people, 'hierarchy_order')
  const levels = [...peopleByLevel.keys()].sort((a, b) => Number(a) - Number(b))
  let cursorY = origin.y
  let previousLevelPeople = []
  const renderedPersonIds = new Set()

  levels.forEach((level) => {
    const levelPeople = peopleByLevel.get(level)
    const columns = getColumnCount(levelPeople.length)
    const levelWidth = columns * CARD_WIDTH + (columns - 1) * CARD_GAP
    const startX = origin.x + (HEADER_WIDTH - levelWidth) / 2
    const labelId = `level-${department.id}-${level}`

    nodes.push({
      id: labelId,
      type: 'level',
      position: { x: origin.x, y: cursorY - 48 },
      data: { label: levelPeople[0]?.hierarchy_level || `Nivel ${level}` },
      selectable: false,
      draggable: false,
      zIndex: 2,
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
        draggable: false,
        zIndex: 4,
      })

      if (person.manager_id && renderedPersonIds.has(person.manager_id)) {
        edges.push(createEdge(`manager-${person.manager_id}-${person.id}`, `person-${person.manager_id}`, personNodeId, '#0e7490'))
      } else if (previousLevelPeople.length > 0) {
        const parent = previousLevelPeople[personIndex % previousLevelPeople.length]
        edges.push(createEdge(`visual-${parent.id}-${person.id}`, `person-${parent.id}`, personNodeId, '#0e7490'))
      } else {
        edges.push(createEdge(`department-${department.id}-${person.id}`, `department-${department.id}`, personNodeId, '#b7dbe2'))
      }

      renderedPersonIds.add(person.id)
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
    interactionWidth: 18,
    pathOptions: { borderRadius: 14 },
    style: { stroke, strokeWidth },
  }
}

function getDepartmentBlockHeight(people, isExpanded) {
  if (!isExpanded) return HEADER_HEIGHT
  const peopleByLevel = groupBy(people, 'hierarchy_order')
  const peopleHeight = [...peopleByLevel.values()].reduce((height, levelPeople) => {
    const columns = getColumnCount(levelPeople.length)
    return height + Math.ceil(levelPeople.length / columns) * ROW_GAP + LEVEL_GAP
  }, 0)
  return HEADER_HEIGHT + 46 + peopleHeight
}

function getColumnCount(count) {
  if (count <= 1) return 1
  return 2
}

function groupBy(items, key) {
  return items.reduce((map, item) => {
    const value = item[key]
    if (!map.has(value)) map.set(value, [])
    map.get(value).push(item)
    return map
  }, new Map())
}
