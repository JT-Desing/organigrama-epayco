import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Filter,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  PanelRightOpen,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { gsap } from 'gsap'
import { createSupabaseClient, hasSupabaseConfig } from './lib/supabase'
import {
  buildChangeSet,
  createEmptyPerson,
  mapImportedRows,
  parseWorkbookFile,
  summarizeChanges,
} from './lib/importer'
import { buildFlowModel, normalizeCatalog } from './lib/orgLayout'
import demoSeed from './data/ipqSeed.json'

const supabase = createSupabaseClient()
const corporateDomain = import.meta.env.VITE_CORPORATE_DOMAIN || 'epayco.com'
const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || 'julian.tobon@epayco.com').toLowerCase()
const localDemoMode =
  import.meta.env.DEV &&
  (!hasSupabaseConfig || new URLSearchParams(window.location.search).has('demo'))
const initialDepartmentId = new URLSearchParams(window.location.search).get('dept')

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function normalizeCorporateEmail(value, fallbackName = '') {
  const raw = String(value || fallbackName || '').trim().toLowerCase()
  if (!raw) return ''
  const [localPart] = raw.split('@')
  const normalizedLocalPart = localPart
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return normalizedLocalPart ? `${normalizedLocalPart}@${corporateDomain}` : ''
}

function DepartmentNode({ data }) {
  return (
    <button
      className={clsx('department-node', data.expanded && 'is-expanded')}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        data.onToggle()
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="department-node__header">
        <div className="department-node__icon">
          <Building2 size={18} />
        </div>
        <div className="department-node__copy">
          <span className="department-node__eyebrow">Departamento</span>
          <p>{data.name}</p>
          <span>Orden {data.sort_order} / {data.count} personas activas</span>
        </div>
        <span className="department-node__chevron" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </button>
  )
}

function CompanyNode({ data }) {
  return (
    <div className="company-node">
      <Handle type="target" position={Position.Top} />
      <div className="company-node__mark">eP</div>
      <div>
        <span>Empresa</span>
        <strong>{data.name}</strong>
        <small>{data.count} personas / {data.departments} areas</small>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

function DepartmentFrameNode({ data }) {
  return <div className="department-frame-node" style={{ width: data.width, height: data.height }} />
}

function PersonNode({ data }) {
  return (
    <button className="person-node" type="button" onClick={data.onOpen}>
      <Handle type="target" position={Position.Top} />
      <span className="person-node__avatar">
        <User size={16} />
      </span>
      <span className="person-node__body">
        <strong>{data.full_name}</strong>
        <small>{data.role}</small>
        <em>{data.hierarchy_level}</em>
      </span>
      <Handle type="source" position={Position.Bottom} />
    </button>
  )
}

function LevelNode({ data }) {
  return <div className="level-node">{data.label}</div>
}

const nodeTypes = {
  company: CompanyNode,
  departmentFrame: DepartmentFrameNode,
  department: DepartmentNode,
  person: PersonNode,
  level: LevelNode,
}

function App() {
  const [session, setSession] = useState(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [mode, setMode] = useState('org')
  const [people, setPeople] = useState(() => (localDemoMode ? demoSeed.people : []))
  const [departments, setDepartments] = useState(() => (localDemoMode ? demoSeed.departments : []))
  const [history, setHistory] = useState(() =>
    localDemoMode
      ? [
          {
            id: 'hist-demo',
            action: 'Carga inicial demo',
            actor: 'sistema',
            target: `${demoSeed.people.length} personas / ${demoSeed.departments.length} departamentos`,
            created_at: new Date().toISOString(),
          },
        ]
      : [],
  )
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [departmentFilter, setDepartmentFilter] = useState(initialDepartmentId || 'all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [expandedDepartmentIds, setExpandedDepartmentIds] = useState(() =>
    initialDepartmentId ? new Set([initialDepartmentId]) : new Set(),
  )
  const [adminDraft, setAdminDraft] = useState(createEmptyPerson())
  const [importState, setImportState] = useState(null)
  const [busyMessage, setBusyMessage] = useState('')
  const loginPanelRef = useRef(null)
  const appShellRef = useRef(null)
  const topbarRef = useRef(null)
  const sidebarRef = useRef(null)
  const workspaceRef = useRef(null)

  const demoMode = localDemoMode
  const signedIn = demoMode || Boolean(session)
  const normalized = useMemo(() => normalizeCatalog(people, departments), [people, departments])

  useEffect(() => {
    if (signedIn || prefersReducedMotion() || !loginPanelRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        loginPanelRef.current,
        { autoAlpha: 0, y: 24, scale: 0.98 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.55,
          ease: 'power3.out',
          clearProps: 'opacity,visibility,transform',
        },
      )
    })
    return () => ctx.revert()
  }, [signedIn])

  useEffect(() => {
    if (!signedIn || prefersReducedMotion()) return
    const targets = [topbarRef.current, sidebarRef.current, workspaceRef.current].filter(Boolean)
    const ctx = gsap.context(() => {
      gsap.set(targets, { clearProps: 'opacity,visibility,transform' })
      gsap.from(targets, {
        y: 12,
        duration: 0.46,
        stagger: 0.06,
        ease: 'power3.out',
        clearProps: 'transform',
      })
    }, appShellRef.current)
    return () => ctx.revert()
  }, [signedIn])

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const isAdmin = useMemo(() => {
    const email = session?.user?.email?.toLowerCase() || ''
    return demoMode || email === adminEmail
  }, [demoMode, session])
  const effectiveMode = isAdmin ? mode : 'org'


  useEffect(() => {
    if (!supabase || !session) return

    const loadPrivateData = async () => {
      setBusyMessage('Sincronizando datos privados desde Supabase...')
      try {
        const [{ data: dbDepartments, error: deptError }, { data: dbPeople, error: peopleError }, { data: auditRows }] =
          await Promise.all([
            supabase.from('departments').select('*').order('sort_order'),
            supabase.from('people').select('*').order('full_name'),
            supabase.from('change_history').select('*').order('created_at', { ascending: false }).limit(50),
          ])

        if (deptError || peopleError) {
          console.error('Supabase load error', deptError || peopleError)
          setBusyMessage('No fue posible cargar la base desde Supabase. Revisa permisos RLS y datos publicados.')
          return
        }

        setDepartments(dbDepartments || [])
        setPeople(dbPeople || [])
        setHistory(auditRows || [])
        setBusyMessage('')
      } catch (error) {
        console.error('Supabase load error', error)
        setBusyMessage('No fue posible conectar con Supabase. Revisa la configuracion del proyecto.')
      }
    }

    loadPrivateData()
  }, [session])

  const visiblePeople = useMemo(() => {
    const text = deferredQuery.trim().toLowerCase()
    return normalized.people.filter((person) => {
      const matchesText =
        !text ||
        [person.full_name, person.role, person.email, person.department_name]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(text))
      const matchesStatus = statusFilter === 'all' || person.status === statusFilter
      return matchesText && matchesStatus
    })
  }, [deferredQuery, normalized.people, statusFilter])

  const effectiveExpandedDepartmentIds = useMemo(() => {
    if (departmentFilter !== 'all') return new Set([departmentFilter])
    return expandedDepartmentIds
  }, [departmentFilter, expandedDepartmentIds])

  const metrics = useMemo(
    () => ({
      activePeople: people.filter((person) => person.status === 'active').length,
      inactivePeople: people.filter((person) => person.status === 'inactive').length,
      departments: departments.filter((department) => department.status !== 'inactive').length,
      admins: demoMode ? 'demo' : session?.user?.email,
    }),
    [demoMode, departments, people, session],
  )

  const selectDepartment = useCallback((id) => {
    setDepartmentFilter(id)
    setMode('org')
    setExpandedDepartmentIds(id === 'all' ? new Set() : new Set([id]))
  }, [])

  const toggleDepartment = useCallback((id) => {
    setMode('org')
    setExpandedDepartmentIds((current) => {
      if (current.has(id)) {
        setDepartmentFilter('all')
        return new Set()
      }
      setDepartmentFilter(id)
      return new Set([id])
    })
  }, [])

  const flowModel = useMemo(
    () =>
      buildFlowModel({
        departments: normalized.departments,
        people: visiblePeople,
        onOpenPerson: (person) => setSelectedPerson(person),
        onToggleDepartment: toggleDepartment,
        expandedDepartmentIds: effectiveExpandedDepartmentIds,
      }),
    [effectiveExpandedDepartmentIds, normalized.departments, toggleDepartment, visiblePeople],
  )

  const signIn = async (event) => {
    event.preventDefault()
    setAuthNotice('')
    const email = authEmail.trim().toLowerCase()
    if (!email.endsWith(`@${corporateDomain}`)) {
      setAuthNotice(`Solo se permite ingreso con correos @${corporateDomain}.`)
      return
    }
    if (!supabase) {
      setAuthNotice('Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para habilitar el acceso privado.')
      return
    }
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split(/[?#]/)[0] },
    })
    setAuthLoading(false)
    setAuthNotice(error ? error.message : 'Revisa tu correo para ingresar con magic link.')
  }

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut()
    setSession(null)
  }

  const persistLocalChange = (action, nextPeople, nextDepartments, target) => {
    setPeople(nextPeople)
    setDepartments(nextDepartments)
    setHistory((items) => [
      {
        id: crypto.randomUUID(),
        action,
        actor: session?.user?.email || 'admin.demo@epayco.com',
        target,
        created_at: new Date().toISOString(),
      },
      ...items,
    ])
  }

  const handleImportFile = async (file) => {
    setBusyMessage('Leyendo archivo y comparando contra el organigrama actual...')
    const rows = await parseWorkbookFile(file)
    const mapped = mapImportedRows(rows)
    const changes = buildChangeSet(mapped, normalized.people, normalized.departments)
    setImportState({ fileName: file.name, rows: mapped, changes, summary: summarizeChanges(changes) })
    setBusyMessage('')
  }

  const confirmImport = async () => {
    if (!isAdmin) return
    if (!importState) return
    const { nextPeople, nextDepartments } = applyImport(importState.rows, normalized.people, normalized.departments)

    if (supabase && session) {
      setBusyMessage('Aplicando cambios en Supabase...')
      await upsertImportToSupabase(importState.rows, nextPeople, nextDepartments, session.user.email)
      setBusyMessage('')
    }

    persistLocalChange('Carga masiva confirmada', nextPeople, nextDepartments, importState.fileName)
    setImportState(null)
  }

  const saveManualPerson = (event) => {
    event.preventDefault()
    if (!isAdmin) return
    const person = {
      ...adminDraft,
      id: adminDraft.id || crypto.randomUUID(),
      department_id: adminDraft.department_id || departments[0]?.id,
      email: normalizeCorporateEmail(adminDraft.email, adminDraft.full_name),
      updated_at: new Date().toISOString(),
    }
    const exists = people.some((item) => item.id === person.id)
    const nextPeople = exists ? people.map((item) => (item.id === person.id ? person : item)) : [...people, person]
    persistLocalChange(exists ? 'Persona editada manualmente' : 'Persona creada manualmente', nextPeople, departments, person.full_name)
    setAdminDraft(createEmptyPerson())
  }

  if (!signedIn) {
    return (
      <main className="login-shell">
        <section ref={loginPanelRef} className="login-panel" aria-labelledby="login-title">
          <div className="brand-lock">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">Organigrama privado ePayco</p>
          <h1 id="login-title">Ingreso seguro sin contraseñas manuales</h1>
          <p className="login-copy">
            Accede con magic link usando tu correo corporativo autorizado. Los datos se consultan desde Supabase
            únicamente después de autenticar la sesión.
          </p>
          <form onSubmit={signIn} className="login-form">
            <label htmlFor="email">Correo corporativo</label>
            <div className="field-with-icon">
              <Mail size={18} />
              <input
                id="email"
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder={`usuario@${corporateDomain}`}
                required
              />
            </div>
            <button type="submit" disabled={authLoading}>
              <Lock size={18} />
              {authLoading ? 'Enviando...' : 'Enviar magic link'}
            </button>
            {authNotice && <p className="form-notice">{authNotice}</p>}
          </form>
        </section>
      </main>
    )
  }

  return (
    <ReactFlowProvider>
      <div ref={appShellRef} className={clsx('app-shell', !sidebarOpen && 'is-sidebar-collapsed')}>
        <TopBar
          topbarRef={topbarRef}
          mode={effectiveMode}
          setMode={setMode}
          demoMode={demoMode}
          sessionEmail={session?.user?.email}
          signOut={signOut}
          isAdmin={isAdmin}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
        <aside ref={sidebarRef} className="control-rail" aria-label="Filtros del organigrama" aria-hidden={!sidebarOpen}>
          <div className="metric-grid">
            <Metric icon={Users} label="Activas" value={metrics.activePeople} />
            <Metric icon={Clock3} label="Inactivas" value={metrics.inactivePeople} />
            <Metric icon={Building2} label="Areas" value={metrics.departments} />
          </div>

          <div className="filter-card">
            <div className="section-title">
              <Search size={17} />
              <span>Busqueda</span>
            </div>
            <label htmlFor="search">Nombre, cargo, correo o area</label>
            <input
              id="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar persona o equipo"
            />

            <label htmlFor="department">Departamento</label>
            <div className="select-wrap">
              <select
                id="department"
                value={departmentFilter}
                onChange={(event) => selectDepartment(event.target.value)}
              >
                <option value="all">Todos los departamentos</option>
                {normalized.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>

            <label htmlFor="status">Estado</label>
            <div className="select-wrap">
              <select id="status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="active">Solo activos</option>
                <option value="inactive">Solo inactivos</option>
                <option value="all">Todos</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </div>

          <DepartmentList
            departments={normalized.departments}
            people={normalized.people}
            selectedId={departmentFilter}
            onPick={selectDepartment}
          />
        </aside>

        <main ref={workspaceRef} className="workspace">
          {busyMessage && <div className="busy-banner">{busyMessage}</div>}
          {effectiveMode === 'org' ? (
            <OrgCanvas flowModel={flowModel} visiblePeople={visiblePeople} selectedDepartmentId={departmentFilter} />
          ) : (
            <AdminPanel
              departments={normalized.departments}
              people={normalized.people}
              history={history}
              importState={importState}
              onFile={handleImportFile}
              onConfirmImport={confirmImport}
              onCancelImport={() => setImportState(null)}
              adminDraft={adminDraft}
              setAdminDraft={setAdminDraft}
              onSaveManualPerson={saveManualPerson}
              onEditPerson={setAdminDraft}
            />
          )}
        </main>

        {selectedPerson && (
          <PersonDrawer
            person={selectedPerson}
            people={normalized.people}
            onClose={() => setSelectedPerson(null)}
            onEdit={(person) => {
              setAdminDraft(person)
              setMode('admin')
              setSelectedPerson(null)
            }}
            canEdit={isAdmin}
          />
        )}
      </div>
    </ReactFlowProvider>
  )
}

function TopBar({ topbarRef, mode, setMode, demoMode, sessionEmail, signOut, isAdmin, sidebarOpen, onToggleSidebar }) {
  return (
    <header ref={topbarRef} className="topbar">
      <div className="topbar__brand">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Cerrar menu lateral' : 'Abrir menu lateral'}
        >
          {sidebarOpen ? <X size={17} /> : <Filter size={17} />}
        </button>
        <span className="logo-mark">eP</span>
        <div>
          <strong>Organigrama ePayco</strong>
          <small>{demoMode ? 'Modo demo local' : sessionEmail}</small>
        </div>
      </div>
      <nav className="topbar__nav" aria-label="Vista principal">
        <button type="button" className={clsx(mode === 'org' && 'is-active')} onClick={() => setMode('org')}>
          <LayoutDashboard size={17} />
          Canvas
        </button>
        {isAdmin && (
          <button type="button" className={clsx(mode === 'admin' && 'is-active')} onClick={() => setMode('admin')}>
            <PanelRightOpen size={17} />
            Administracion
          </button>
        )}
      </nav>
      <div className="topbar__actions">
        <span className="privacy-pill">
          <ShieldCheck size={15} />
          RLS + Auth
        </span>
        {!demoMode && (
          <button type="button" className="icon-button" onClick={signOut} aria-label="Cerrar sesion">
            <LogOut size={18} />
          </button>
        )}
      </div>
    </header>
  )
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DepartmentList({ departments, people, selectedId, onPick }) {
  const counts = useMemo(
    () =>
      people.reduce((acc, person) => {
        if (person.status === 'active') acc[person.department_id] = (acc[person.department_id] || 0) + 1
        return acc
      }, {}),
    [people],
  )

  return (
    <div className="department-list">
      <div className="section-title">
        <Filter size={17} />
        <span>Areas</span>
      </div>
      <button type="button" className={clsx(selectedId === 'all' && 'is-active')} onClick={() => onPick('all')}>
        <span>Todos los departamentos</span>
        <strong>{people.filter((person) => person.status === 'active').length}</strong>
      </button>
      {departments.map((department) => (
        <button
          key={department.id}
          type="button"
          className={clsx(selectedId === department.id && 'is-active')}
          onClick={() => onPick(department.id)}
        >
          <span>{department.name}</span>
          <strong>{counts[department.id] || 0}</strong>
        </button>
      ))}
    </div>
  )
}

function OrgCanvas({ flowModel, visiblePeople, selectedDepartmentId }) {
  const { fitView, setViewport } = useReactFlow()
  const canvasRef = useRef(null)

  const buildViewport = useCallback((centerX, centerY, zoom) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const width = rect?.width || 1200
    const height = rect?.height || 820
    return {
      x: width / 2 - centerX * zoom,
      y: height / 2 - centerY * zoom,
      zoom,
    }
  }, [])

  const focusCanvas = useCallback(() => {
    if (selectedDepartmentId && selectedDepartmentId !== 'all') {
      const focusPoint = flowModel.focusPoints?.[selectedDepartmentId]
      if (focusPoint) {
        setViewport(buildViewport(focusPoint.x, focusPoint.y, focusPoint.zoom || 0.78), { duration: 650 })
        return
      }
    }

    if (flowModel.overview) {
      setViewport(buildViewport(flowModel.overview.x, flowModel.overview.y, flowModel.overview.zoom), { duration: 650 })
      return
    }

    fitView({ padding: 0.32, duration: 450 })
  }, [buildViewport, fitView, flowModel.focusPoints, flowModel.overview, selectedDepartmentId, setViewport])

  useEffect(() => {
    if (flowModel.nodes.length === 0) return undefined
    if (!selectedDepartmentId || selectedDepartmentId === 'all') return undefined
    const timeout = window.setTimeout(focusCanvas, 700)
    return () => window.clearTimeout(timeout)
  }, [flowModel.nodes.length, focusCanvas, selectedDepartmentId, visiblePeople.length])

  useEffect(() => {
    if (prefersReducedMotion() || !canvasRef.current) return
    let ctx
    const timeout = window.setTimeout(() => {
      ctx = gsap.context(() => {
        gsap.fromTo(
          '.company-node, .department-node, .person-node, .level-node',
          { y: 14, scale: 0.96 },
          {
            y: 0,
            scale: 1,
            duration: 0.38,
            stagger: 0.018,
            ease: 'power2.out',
            clearProps: 'transform',
          },
        )
        gsap.fromTo(
          '.react-flow__node-departmentFrame',
          { scale: 0.985 },
          { scale: 1, duration: 0.28, ease: 'power2.out', clearProps: 'transform' },
        )
        gsap.fromTo(
          '.canvas-toolbar',
          { y: -8 },
          { y: 0, duration: 0.34, ease: 'power2.out', clearProps: 'transform' },
        )
        }, canvasRef.current)
    }, 60)
    return () => {
      window.clearTimeout(timeout)
      ctx?.revert()
    }
  }, [flowModel.nodes.length, selectedDepartmentId])

  return (
    <section ref={canvasRef} className="canvas-panel" aria-label="Canvas del organigrama">
      <div className="canvas-toolbar">
        <div>
          <strong>{visiblePeople.length}</strong>
          <span>personas visibles</span>
        </div>
        <button type="button" onClick={focusCanvas}>
          <CheckCircle2 size={17} />
          Ajustar vista
        </button>
      </div>
      <ReactFlow
        nodes={flowModel.nodes}
        edges={flowModel.edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => {
          if (node.type === 'department') node.data.onToggle()
        }}
        minZoom={0.18}
        maxZoom={1.8}
        defaultViewport={{ x: 100, y: 145, zoom: 0.54 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#cbd5e1" gap={22} size={1} />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
        <Controls position="bottom-right" />
        <Panel position="top-right" className="canvas-hint">
          Haz clic en un departamento para desplegarlo
        </Panel>
      </ReactFlow>
      {flowModel.nodes.length === 0 && (
        <div className="canvas-empty">
          <Building2 size={28} />
          <strong>No hay datos para mostrar</strong>
          <span>La sesion esta activa, pero Supabase no devolvio departamentos ni personas.</span>
        </div>
      )}
    </section>
  )
}

function PersonDrawer({ person, people, onClose, onEdit, canEdit }) {
  const manager = people.find((item) => item.id === person.manager_id)
  return (
    <aside className="drawer" aria-label="Detalle de persona">
      <div className="drawer__header">
        <div className="drawer__avatar">
          <User size={24} />
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar detalle">
          <X size={18} />
        </button>
      </div>
      <h2>{person.full_name}</h2>
      <p className="drawer__role">{person.role}</p>
      <dl>
        <div>
          <dt>Correo corporativo</dt>
          <dd>{person.email || 'Pendiente'}</dd>
        </div>
        <div>
          <dt>Departamento</dt>
          <dd>{person.department_name}</dd>
        </div>
        <div>
          <dt>Jefe directo</dt>
          <dd>{manager?.full_name || 'Sin asignar'}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>
            <span className={clsx('status-dot', person.status)}>{person.status}</span>
          </dd>
        </div>
        <div>
          <dt>Nivel jerarquico</dt>
          <dd>{person.hierarchy_level || 'Sin nivel'}</dd>
        </div>
        <div>
          <dt>Ultima actualizacion</dt>
          <dd>{formatDate(person.updated_at)}</dd>
        </div>
      </dl>
      {canEdit && (
        <button type="button" className="primary-action" onClick={() => onEdit(person)}>
          Editar en administracion
        </button>
      )}
    </aside>
  )
}

function AdminPanel({
  departments,
  people,
  history,
  importState,
  onFile,
  onConfirmImport,
  onCancelImport,
  adminDraft,
  setAdminDraft,
  onSaveManualPerson,
  onEditPerson,
}) {
  const [activeTab, setActiveTab] = useState('upload')
  const topPeople = people.slice(0, 18)

  return (
    <section className="admin-layout">
      <div className="admin-tabs" role="tablist" aria-label="Panel administrativo">
        <button className={clsx(activeTab === 'upload' && 'is-active')} onClick={() => setActiveTab('upload')}>
          <Upload size={17} />
          Carga masiva
        </button>
        <button className={clsx(activeTab === 'manual' && 'is-active')} onClick={() => setActiveTab('manual')}>
          <Plus size={17} />
          Edicion manual
        </button>
        <button className={clsx(activeTab === 'history' && 'is-active')} onClick={() => setActiveTab('history')}>
          <History size={17} />
          Historial
        </button>
      </div>

      {activeTab === 'upload' && (
        <div className="admin-grid">
          <div className="upload-box">
            <FileSpreadsheet size={34} />
            <h2>Cargar Excel o CSV</h2>
            <p>
              Columnas aceptadas: nombre, cargo, correo, departamento, jefe directo, estado. Tambien reconoce la base
              actual con nombre mostrado, nombre departamento y nombre posicion.
            </p>
            <label className="file-input">
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])}
              />
              <Upload size={17} />
              Seleccionar archivo
            </label>
          </div>
          <ImportSummary importState={importState} onConfirm={onConfirmImport} onCancel={onCancelImport} />
        </div>
      )}

      {activeTab === 'manual' && (
        <div className="admin-grid">
          <ManualPersonForm
            departments={departments}
            people={people}
            draft={adminDraft}
            setDraft={setAdminDraft}
            onSave={onSaveManualPerson}
          />
          <div className="table-card">
            <h2>Personas recientes</h2>
            <div className="people-table">
              {topPeople.map((person) => (
                <button type="button" key={person.id} onClick={() => onEditPerson(person)}>
                  <span>{person.full_name}</span>
                  <small>{person.role}</small>
                  <strong>{person.department_name}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="history-card">
          <h2>Historial de cambios</h2>
          {history.map((item) => (
            <article key={item.id}>
              <span>{formatDate(item.created_at)}</span>
              <strong>{item.action}</strong>
              <p>{item.target}</p>
              <small>{item.actor || item.changed_by || 'administrador'}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function ImportSummary({ importState, onConfirm, onCancel }) {
  if (!importState) {
    return (
      <div className="summary-empty">
        <ShieldCheck size={28} />
        <h2>Validacion previa obligatoria</h2>
        <p>Antes de modificar datos, el sistema mostrara nuevos registros, actualizaciones, bajas, duplicados y errores.</p>
      </div>
    )
  }

  const cards = [
    ['Nuevas personas', importState.summary.newPeople],
    ['Personas actualizadas', importState.summary.updatedPeople],
    ['Personas ausentes', importState.summary.missingPeople],
    ['Nuevos departamentos', importState.summary.newDepartments],
    ['Cambios de cargo', importState.summary.roleChanges],
    ['Cambios de departamento', importState.summary.departmentChanges],
    ['Cambios de jefe', importState.summary.managerChanges],
    ['Errores / duplicados', importState.summary.issues],
  ]

  return (
    <div className="summary-card">
      <div className="summary-card__header">
        <div>
          <span>Archivo analizado</span>
          <strong>{importState.fileName}</strong>
        </div>
        <span>{importState.rows.length} filas</span>
      </div>
      <div className="change-grid">
        {cards.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {importState.changes.issues.length > 0 && (
        <div className="issue-list">
          {importState.changes.issues.slice(0, 8).map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
      <div className="summary-actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="primary-action" onClick={onConfirm}>
          Confirmar cambios
        </button>
      </div>
    </div>
  )
}

function ManualPersonForm({ departments, people, draft, setDraft, onSave }) {
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
  return (
    <form className="manual-form" onSubmit={onSave}>
      <h2>{draft.id ? 'Editar persona' : 'Agregar persona'}</h2>
      <label htmlFor="full-name">Nombre completo</label>
      <input id="full-name" value={draft.full_name} onChange={(event) => update('full_name', event.target.value)} required />
      <label htmlFor="role">Cargo</label>
      <input id="role" value={draft.role} onChange={(event) => update('role', event.target.value)} required />
      <label htmlFor="person-email">Correo</label>
      <input id="person-email" type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} />
      <label htmlFor="person-department">Departamento</label>
      <select id="person-department" value={draft.department_id} onChange={(event) => update('department_id', event.target.value)}>
        <option value="">Seleccionar departamento</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>
      <label htmlFor="manager">Jefe directo</label>
      <select id="manager" value={draft.manager_id || ''} onChange={(event) => update('manager_id', event.target.value || null)}>
        <option value="">Sin asignar</option>
        {people
          .filter((person) => person.id !== draft.id)
          .map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
      </select>
      <label htmlFor="person-status">Estado</label>
      <select id="person-status" value={draft.status} onChange={(event) => update('status', event.target.value)}>
        <option value="active">Activo</option>
        <option value="inactive">Inactivo</option>
      </select>
      <button type="submit" className="primary-action">
        Guardar cambios
      </button>
    </form>
  )
}

function applyImport(rows, currentPeople, currentDepartments) {
  const now = new Date().toISOString()
  const departmentMap = new Map(currentDepartments.map((department) => [department.name.toLowerCase(), department]))
  const nextDepartments = [...currentDepartments]
  const importedKeys = new Set()
  const peopleByEmail = new Map(currentPeople.filter((person) => person.email).map((person) => [person.email.toLowerCase(), person]))
  const peopleByName = new Map(currentPeople.map((person) => [person.full_name.toLowerCase(), person]))

  const nextPeople = rows.reduce((acc, row) => {
    let department = departmentMap.get(row.department_name.toLowerCase())
    if (!department) {
      department = {
        id: crypto.randomUUID(),
        name: row.department_name,
        parent_id: null,
        sort_order: nextDepartments.length + 1,
        status: 'active',
      }
      departmentMap.set(department.name.toLowerCase(), department)
      nextDepartments.push(department)
    }

    const key = (row.email || row.full_name).toLowerCase()
    importedKeys.add(key)
    if (row.full_name) importedKeys.add(row.full_name.toLowerCase())
    const existing = (row.email && peopleByEmail.get(row.email.toLowerCase())) || peopleByName.get(row.full_name.toLowerCase())
    const updated = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      full_name: row.full_name,
      role: row.role,
      email: row.email,
      department_id: department.id,
      manager_id: null,
      status: row.status || 'active',
      department_sort_order: row.department_sort_order || department.sort_order || 999,
      hierarchy_order: row.hierarchy_order || 99,
      hierarchy_level: row.hierarchy_level || 'Sin nivel',
      updated_at: now,
    }
    if (existing) return acc.map((person) => (person.id === existing.id ? updated : person))
    return [...acc, updated]
  }, currentPeople)

  const inactivePeople = nextPeople.map((person) => {
    const key = (person.email || person.full_name).toLowerCase()
    const nameKey = person.full_name.toLowerCase()
    return importedKeys.has(key) || importedKeys.has(nameKey) ? person : { ...person, status: 'inactive', updated_at: now }
  })

  return { nextPeople: inactivePeople, nextDepartments }
}

async function upsertImportToSupabase(rows, people, departments, actor) {
  await supabase.from('departments').upsert(departments, { onConflict: 'id' })
  await supabase.from('people').upsert(people, { onConflict: 'id' })
  await supabase.from('change_history').insert({
    action: 'Carga masiva confirmada',
    target: `${rows.length} filas importadas`,
    actor,
  })
}

function formatDate(value) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default App
