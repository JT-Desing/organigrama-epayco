const CARD_WIDTH = 252
const CARD_GAP = 30
const CARD_ROW_GAP = 142
const SECTION_LABEL_HEIGHT = 34
const SECTION_LABEL_GAP = 26
const SECTION_LEVEL_GAP = 44
const SECTION_GAP = 72
const HEADER_WIDTH = 620
const HEADER_HEIGHT = 104
const COMPANY_WIDTH = 460
const BLOCK_GAP_X = 116
const BLOCK_GAP_Y = 154
const TOP = 58
const DEPARTMENT_TOP = TOP + 192

export function normalizeCatalog(people, departments) {
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  const normalizedDepartments = departments
    .map((department, index) => ({
      ...department,
      sort_order: Number(department.sort_order ?? index + 1),
      status: department.status || 'active',
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  const normalizedPeople = people.map((person) => {
    const department = departmentById.get(person.department_id)
    const hierarchyOrder = Number(person.hierarchy_order || 99)
    const sectionLabel = cleanLabel(person.subarea || person.group_name || person.hierarchy_level || `Nivel ${hierarchyOrder}`)

    return {
      ...person,
      full_name: person.full_name || person.name || 'Sin nombre',
      role: person.role || person.cargo || 'Cargo pendiente',
      status: person.status || 'active',
      department_name: department?.name || 'Departamento pendiente',
      hierarchy_order: hierarchyOrder,
      hierarchy_level: cleanLabel(person.hierarchy_level || person.group_name || person.subarea || `Nivel ${hierarchyOrder}`),
      department_sort_order: Number(person.department_sort_order || department?.sort_order || 999),
      global_order: Number(person.global_order || person.source_row || 999),
      group_order: Number(person.group_order || person.global_order || person.source_row || 999),
      subarea: cleanLabel(person.subarea),
      group_name: cleanLabel(person.group_name),
      section_label: sectionLabel,
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
    selectable: false,
  })

  for (let index = 0; index < activeDepartments.length; index += departmentColumns) {
    const rowDepartments = activeDepartments.slice(index, index + departmentColumns)
    const rowLayouts = rowDepartments.map((department, columnIndex) => {
      const departmentPeople = (peopleByDepartment.get(department.id) || []).sort(comparePeople)
      const isExpanded = expanded.has(department.id)
      const sections = createDepartmentSections(departmentPeople)
      const blockHeight = getDepartmentBlockHeight(sections, isExpanded)

      return {
        department,
        departmentPeople,
        sections,
        isExpanded,
        blockHeight,
        x: columnIndex * (HEADER_WIDTH + BLOCK_GAP_X),
        y: rowY,
      }
    })

    departmentLayouts.push(...rowLayouts)
    rowY += Math.max(...rowLayouts.map((layout) => layout.blockHeight)) + BLOCK_GAP_Y
  }

  departmentLayouts.forEach(({ department, departmentPeople, sections, isExpanded, blockHeight, x, y }) => {
    const focusOffset = isExpanded ? Math.min(blockHeight / 2, HEADER_HEIGHT + 260) : HEADER_HEIGHT / 2

    focusPoints[department.id] = {
      x: x + HEADER_WIDTH / 2,
      y: y + focusOffset,
      zoom: isExpanded ? 0.68 : 0.86,
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
      selectable: false,
      zIndex: 3,
    })

    edges.push(
      createEdge(
        `company-${department.id}`,
        'company-epayco',
        `department-${department.id}`,
        isExpanded ? '#087f8d' : '#c4d8e5',
        isExpanded ? 1.45 : 0.82,
      ),
    )

    if (isExpanded) {
      buildDepartmentPeople({
        nodes,
        edges,
        department,
        sections,
        origin: { x, y: y + HEADER_HEIGHT + 64 },
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
      zoom: 0.46,
    },
  }
}

function buildDepartmentPeople({ nodes, edges, department, sections, origin, onOpenPerson }) {
  let cursorY = origin.y
  const renderedPersonIds = new Set()

  sections.forEach((section) => {
    const labelId = `section-${department.id}-${section.key}`

    nodes.push({
      id: labelId,
      type: 'level',
      position: { x: origin.x, y: cursorY },
      data: { label: section.label },
      selectable: false,
      draggable: false,
      zIndex: 2,
    })

    let cardsY = cursorY + SECTION_LABEL_HEIGHT + SECTION_LABEL_GAP
    const sectionPeopleByLevel = groupPeopleByLevel(section.people)
    const levels = [...sectionPeopleByLevel.keys()].sort((a, b) => Number(a) - Number(b))

    levels.forEach((level, levelIndex) => {
      const levelPeople = sectionPeopleByLevel.get(level).sort(comparePeople)
      const columns = getColumnCount(levelPeople.length)
      const levelWidth = columns * CARD_WIDTH + (columns - 1) * CARD_GAP
      const startX = origin.x + (HEADER_WIDTH - levelWidth) / 2

      levelPeople.forEach((person, personIndex) => {
        const col = personIndex % columns
        const row = Math.floor(personIndex / columns)
        const personNodeId = `person-${person.id}`
        const position = {
          x: startX + col * (CARD_WIDTH + CARD_GAP),
          y: cardsY + row * CARD_ROW_GAP,
        }

        nodes.push({
          id: personNodeId,
          type: 'person',
          position,
          data: { ...person, onOpen: () => onOpenPerson(person) },
          draggable: false,
          selectable: false,
          zIndex: 4,
        })

        if (person.manager_id && renderedPersonIds.has(person.manager_id)) {
          edges.push(createEdge(`manager-${person.manager_id}-${person.id}`, `person-${person.manager_id}`, personNodeId, '#087f8d'))
        } else {
          edges.push(createEdge(`department-${department.id}-${person.id}`, `department-${department.id}`, personNodeId, '#b7dbe2', 1.05))
        }
      })

      levelPeople.forEach((person) => renderedPersonIds.add(person.id))
      cardsY += Math.ceil(levelPeople.length / columns) * CARD_ROW_GAP
      if (levelIndex < levels.length - 1) cardsY += SECTION_LEVEL_GAP
    })

    cursorY = cardsY + SECTION_GAP
  })
}

function createDepartmentSections(people) {
  const personToSectionKey = new Map()
  const sectionsByKey = new Map()

  people.forEach((person) => {
    const label = sectionLabelFor(person)
    const key = `${slug(label)}-${person.department_id}`
    personToSectionKey.set(person.id, key)

    if (!sectionsByKey.has(key)) {
      sectionsByKey.set(key, {
        key,
        label,
        people: [],
        dependencies: new Set(),
        order: {
          hierarchy: person.hierarchy_order,
          group: person.group_order,
          global: person.global_order,
        },
      })
    }

    const section = sectionsByKey.get(key)
    section.people.push(person)
    section.order = {
      hierarchy: Math.min(section.order.hierarchy, person.hierarchy_order),
      group: Math.min(section.order.group, person.group_order),
      global: Math.min(section.order.global, person.global_order),
    }
  })

  for (const section of sectionsByKey.values()) {
    section.people.forEach((person) => {
      const managerSectionKey = person.manager_id ? personToSectionKey.get(person.manager_id) : null
      if (managerSectionKey && managerSectionKey !== section.key) section.dependencies.add(managerSectionKey)
    })
  }

  return sortSections([...sectionsByKey.values()])
}

function sortSections(sections) {
  const sorted = []
  const remaining = new Map(sections.map((section) => [section.key, section]))

  while (remaining.size > 0) {
    const available = [...remaining.values()]
      .filter((section) => [...section.dependencies].every((dependency) => !remaining.has(dependency)))
      .sort(compareSections)

    const next = available[0] || [...remaining.values()].sort(compareSections)[0]
    sorted.push(next)
    remaining.delete(next.key)
  }

  return sorted
}

function compareSections(a, b) {
  return (
    a.order.hierarchy - b.order.hierarchy ||
    a.order.group - b.order.group ||
    a.order.global - b.order.global ||
    a.label.localeCompare(b.label)
  )
}

function groupPeopleByLevel(people) {
  return people.reduce((map, person) => {
    const level = person.hierarchy_order || 99
    if (!map.has(level)) map.set(level, [])
    map.get(level).push(person)
    return map
  }, new Map())
}

function createEdge(id, source, target, stroke, strokeWidth = 1.25) {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    interactionWidth: 18,
    pathOptions: { borderRadius: 18 },
    style: { stroke, strokeWidth },
  }
}

function getDepartmentBlockHeight(sections, isExpanded) {
  if (!isExpanded) return HEADER_HEIGHT
  const sectionsHeight = sections.reduce((height, section) => height + getSectionHeight(section), 0)
  return HEADER_HEIGHT + 64 + sectionsHeight
}

function getSectionHeight(section) {
  const levels = [...groupPeopleByLevel(section.people).values()]
  const cardsHeight = levels.reduce((height, levelPeople, index) => {
    const columns = getColumnCount(levelPeople.length)
    const gap = index < levels.length - 1 ? SECTION_LEVEL_GAP : 0
    return height + Math.ceil(levelPeople.length / columns) * CARD_ROW_GAP + gap
  }, 0)

  return SECTION_LABEL_HEIGHT + SECTION_LABEL_GAP + cardsHeight + SECTION_GAP
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

function comparePeople(a, b) {
  return (
    a.hierarchy_order - b.hierarchy_order ||
    a.group_order - b.group_order ||
    a.global_order - b.global_order ||
    a.full_name.localeCompare(b.full_name)
  )
}

function sectionLabelFor(person) {
  return cleanLabel(person.subarea || person.group_name || person.hierarchy_level || `Nivel ${person.hierarchy_order}`)
}

function cleanLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function slug(value) {
  return cleanLabel(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
