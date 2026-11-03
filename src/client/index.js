/* ------------------------------------------------------------------
 * index.js · 客户端装配
 *
 * 两个挂载点（都已由宿主声明，见 Slots.listSubTree）：
 *  1. `conversation.input.left`：输入框工具栏左侧一个「编排画布」小圆点，
 *     有运行时才出现；点开就是画布。这是用户要的「单独一个可选点」。
 *  2. `shell.overlay`：画布本体，盖在全帧之上，不挤压会话布局。
 *
 * 数据只来自宿主只读接口 /orch-canvas/api/{state,run}；客户端不写任何状态。
 * ------------------------------------------------------------------ */

/** 宿主只读接口前缀（与 src/index.js 的 ORCH_ROUTE_PREFIX 保持一致）。 */
const ORCH_API = '/_dsh/orchestrator-canvas/api'

/** 模块级共享状态：chip 与 overlay 分处两个 slot，靠这里对齐。 */
const orchStore = {
  open: false,
  runId: null,
  loading: false,
  error: null,
  runs: [],
  run: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  selectedNodeId: null,
  /** 当前会话（来自 input.left slot 的 standardProps.sessionId）。 */
  sessionId: null,
  /** 当前会话的工作目录（宿主按 sessionId 反查 header.cwd 得到）。 */
  contextCwd: null,
  /** 运行过滤范围：session（默认）/ workspace / all。 */
  scope: 'session',
  /** 过滤后为空、退回到全部时的提示标记。 */
  scopeFallback: false,
  listeners: new Set(),
}

/**
 * 方案：scope 只存在内存里（默认「本会话」）。
 * 客户端保持「只读」红线——连 localStorage 都不写，避免用户偏好与运行状态混淆。
 */

/** 路径比较：大小写、正反斜杠、末尾斜杠都不该影响「是不是同一个工作区」。 */function orchSamePath(left, right) {
  if (!left || !right) return false
  const normalize = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

/**
 * 按 scope 过滤 runs；过滤后为空但有历史运行时退回全部并标记 fallback，
 * 免得「刚装的插件 + 旧 run 没有归属字段」时画布看起来像空的。
 */
function orchVisibleRuns(state = orchStore) {
  const all = Array.isArray(state.runs) ? state.runs : []
  if (state.scope === 'all') return { runs: all, fallback: false }
  let filtered = []
  if (state.scope === 'session') {
    filtered = all.filter((item) => state.sessionId && item.sessionId === state.sessionId)
  } else if (state.scope === 'workspace') {
    filtered = all.filter((item) => orchSamePath(state.contextCwd, item.cwd))
  }
  if (filtered.length === 0 && all.length > 0) return { runs: all, fallback: true }
  return { runs: filtered, fallback: false }
}

function orchEmit() {
  for (const listener of Array.from(orchStore.listeners)) {
    try {
      listener()
    } catch {
      /* 单个订阅者出错不影响其他订阅者 */
    }
  }
}

function orchSubscribe(listener) {
  orchStore.listeners.add(listener)
  return () => {
    orchStore.listeners.delete(listener)
  }
}

/** 简单的快照 hook：store 变化时触发一次 re-render。 */
function useOrchStore() {
  const [, force] = React.useReducer((n) => n + 1, 0)
  React.useEffect(() => orchSubscribe(force), [])
  return orchStore
}

function orchBase() {
  try {
    return window.location.origin
  } catch {
    return ''
  }
}

async function orchFetchJson(path) {
  const response = await fetch(`${orchBase()}${path}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`宿主接口返回 ${response.status}`)
  const payload = await response.json()
  if (payload && payload.ok === false) throw new Error(payload.error || '宿主接口失败')
  return payload
}

let orchRefreshToken = 0
/** 拉运行列表 + 当前 run 的 brief。保持上一次成功的数据，失败只记错误。 */
async function orchRefresh(runId) {
  const token = ++orchRefreshToken
  orchStore.loading = true
  orchStore.error = null
  orchEmit()
  try {
    const wanted = runId ?? orchStore.runId
    const params = []
    if (wanted) params.push(`runId=${encodeURIComponent(wanted)}`)
    // 带上当前会话，宿主据此回传工作目录（画布默认只看本会话的运行）。
    if (orchStore.sessionId) params.push(`session=${encodeURIComponent(orchStore.sessionId)}`)
    const query = params.length ? `?${params.join('&')}` : ''
    const payload = await orchFetchJson(`${ORCH_API}/state${query}`)
    if (token !== orchRefreshToken) return
    orchStore.runs = Array.isArray(payload.runs) ? payload.runs : []
    if (payload.context && typeof payload.context === 'object') {
      orchStore.contextCwd = payload.context.cwd ?? null
    }
    orchStore.scopeFallback = orchVisibleRuns().fallback
    if (payload.run) {
      orchStore.run = payload.run
      orchStore.runId = payload.run.runId
      if (orchStore.selectedNodeId && !(payload.run.nodes || []).some((n) => n.id === orchStore.selectedNodeId)) {
        orchStore.selectedNodeId = null
      }
    } else {
      orchStore.run = null
    }
  } catch (error) {
    if (token !== orchRefreshToken) return
    orchStore.error = error && error.message ? error.message : String(error)
  } finally {
    if (token === orchRefreshToken) {
      orchStore.loading = false
      orchEmit()
    }
  }
}

let orchDetailToken = 0
/** 打开抽屉时补全节点全量字段（prompt / output / attempts）。 */
async function orchLoadDetail() {
  const runId = orchStore.runId
  if (!runId) return
  if (orchStore.detail && orchStore.detail.runId === runId) return
  const token = ++orchDetailToken
  orchStore.detailLoading = true
  orchStore.detailError = null
  orchEmit()
  try {
    const payload = await orchFetchJson(`${ORCH_API}/run?runId=${encodeURIComponent(runId)}`)
    if (token !== orchDetailToken) return
    orchStore.detail = payload.run ?? null
  } catch (error) {
    if (token !== orchDetailToken) return
    orchStore.detailError = error && error.message ? error.message : String(error)
  } finally {
    if (token === orchDetailToken) {
      orchStore.detailLoading = false
      orchEmit()
    }
  }
}

function orchOpen(runId) {
  orchStore.open = true
  orchStore.runId = runId ?? orchStore.runId ?? null
  orchEmit()
  void orchRefresh(orchStore.runId)
}

function orchClose() {
  orchStore.open = false
  orchStore.selectedNodeId = null
  orchEmit()
}

function orchToggle(runId) {
  if (orchStore.open) orchClose()
  else orchOpen(runId)
}

function orchSelectNode(nodeId) {
  orchStore.selectedNodeId = nodeId
  orchEmit()
  void orchLoadDetail()
}

function orchPickRun(runId) {
  orchStore.runId = runId
  orchStore.detail = null
  orchStore.selectedNodeId = null
  orchEmit()
  void orchRefresh(runId)
}

/** slot 告诉我们当前会话 id：变了就记下来（画布默认按它过滤）。 */
function orchSetSession(sessionId) {
  const next = sessionId ? String(sessionId) : null
  if (orchStore.sessionId === next) return
  orchStore.sessionId = next
  orchStore.scopeFallback = orchVisibleRuns().fallback
  orchEmit()
}

function orchPickScope(scope) {
  if (scope !== 'session' && scope !== 'workspace' && scope !== 'all') return
  if (orchStore.scope === scope) return
  orchStore.scope = scope
  orchStore.scopeFallback = orchVisibleRuns().fallback
  orchEmit()
}

function useOrchCompact() {
  const read = () => {
    try {
      return window.matchMedia(ORCH_COMPACT_QUERY).matches
    } catch {
      return false
    }
  }
  const [compact, setCompact] = React.useState(read)
  React.useEffect(() => {
    let query = null
    const onChange = () => setCompact(read())
    try {
      query = window.matchMedia(ORCH_COMPACT_QUERY)
      if (query.addEventListener) query.addEventListener('change', onChange)
      else if (query.addListener) query.addListener(onChange)
    } catch {
      query = null
    }
    window.addEventListener('resize', onChange)
    return () => {
      window.removeEventListener('resize', onChange)
      if (query) {
        if (query.removeEventListener) query.removeEventListener('change', onChange)
        else if (query.removeListener) query.removeListener(onChange)
      }
    }
  }, [])
  return compact
}

/** 输入端左侧的入口按钮：常驻显示（没有运行时点开就是空画布 + 提示）。 */
function OrchChip(props) {
  const state = useOrchStore()
  const visible = orchVisibleRuns(state)
  const count = visible.runs.length

  React.useEffect(() => {
    // slot 的 standardProps 带着当前会话 id：画布默认只看本会话运行的归属靠它。
    if (props && props.sessionId) orchSetSession(props.sessionId)
    void orchRefresh(orchStore.runId)
    // 关闭状态下低频轮询，任务一开始就能看到运行出现。
    const timer = window.setInterval(() => {
      if (!orchStore.open) void orchRefresh(orchStore.runId)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [])

  const active = visible.runs.filter((run) => run.status === 'active').length
  const label = state.open ? '收起编排画布' : '打开编排画布'
  const title = state.error
    ? `${label}（数据读取失败：${state.error}）`
    : active > 0
      ? `${label}（${active} 个未验收）`
      : count === 0
        ? `${label}（还没有运行）`
        : label
  return h(
    'button',
    {
      type: 'button',
      className: 'orch-chip',
      'data-open': state.open ? 'true' : 'false',
      'data-error': state.error ? 'true' : 'false',
      title,
      'aria-label': label,
      onClick: () => orchToggle(state.runId),
    },
    h('span', { 'aria-hidden': 'true', style: { fontSize: '12px' } }, '◈'),
    h('span', null, '编排画布'),
    count > 0 ? h('span', { className: 'orch-chip-count' }, String(count)) : null,
  )
}

/** 画布本体：overlay 里的一整块面板 + 抽屉。 */
function OrchOverlay() {
  const state = useOrchStore()
  const compact = useOrchCompact()

  // 打开期间 2s 轮询一次：host 只读接口很轻，前端不做推送。
  React.useEffect(() => {
    if (!orchStore.open) return undefined
    void orchRefresh(orchStore.runId)
    const timer = window.setInterval(() => void orchRefresh(orchStore.runId), 2000)
    return () => window.clearInterval(timer)
  }, [state.open, state.runId])

  // Esc 关闭。
  React.useEffect(() => {
    if (!orchStore.open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        orchClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [state.open])

  if (!state.open) return null

  const run = state.run
  const brief = run ? run.brief : null
  const counts = run ? run.counts : null
  const selectValue = state.runId ?? (run ? run.runId : '')
  // 过滤后的列表；当前 run 若被过滤掉（例如刚从「全部」切回「本会话」），
  // 仍然把它留在下拉里，免得画布内容与下拉选项对不上。
  const visible = orchVisibleRuns(state)
  const options = visible.runs.slice()
  if (run && !options.some((item) => item.runId === run.runId)) {
    options.unshift({
      runId: run.runId,
      status: run.status,
      nodeCount: counts ? counts.step + counts.check + counts.merge : 0,
    })
  }

  return h(
    'div',
    { className: 'orch-root' },
    h(
      'div',
      {
        className: 'orch-backdrop',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '编排画布',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) orchClose()
        },
      },
      h(
        'div',
        { className: 'orch-panel' },
        h(
          'div',
          { className: 'orch-head' },
          h('span', { className: 'orch-dot', 'data-status': run ? run.status : 'pending', 'aria-hidden': 'true' }),
          h('span', { className: 'orch-title' }, '编排画布'),
          brief ? h('span', { className: 'orch-sub orch-ellipsis', title: brief }, brief) : h('span', { className: 'orch-sub' }, '还没有运行'),
          counts
            ? h('span', { className: 'orch-sub' }, `执行 ${counts.step} · 检查 ${counts.check} · 汇合 ${counts.merge}`)
            : null,
          state.scopeFallback
            ? h('span', { className: 'orch-note', title: '当前范围没有运行，暂时显示全部' }, '本范围暂无 · 已显示全部')
            : null,
          h('span', { className: 'orch-grow' }),
          h(
            'div',
            { className: 'orch-scope', role: 'group', 'aria-label': '运行范围' },
            ...[
              ['session', '本会话'],
              ['workspace', '本工作区'],
              ['all', '全部'],
            ].map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  className: 'orch-scope-btn',
                  'data-active': state.scope === key ? 'true' : 'false',
                  title:
                    key === 'session'
                      ? '只看当前会话发起的运行'
                      : key === 'workspace'
                        ? '看当前工作区（目录）下所有会话的运行'
                        : '看全部会话、全部目录的运行',
                  onClick: () => orchPickScope(key),
                },
                label,
              ),
            ),
          ),
          options.length > 0
            ? h(
                'select',
                {
                  className: 'orch-select',
                  value: selectValue,
                  onChange: (event) => orchPickRun(event.target.value),
                  title: '切换运行',
                },
                ...options.map((item) =>
                  h(
                    'option',
                    { key: item.runId, value: item.runId },
                    `${item.status === 'active' ? '● ' : ''}${item.runId}${item.nodeCount ? ` · ${item.nodeCount} 节点` : ''}`,
                  ),
                ),
              )
            : null,
          h(
            'span',
            { className: 'orch-head-actions' },
            state.loading ? h('span', { className: 'orch-sub' }, '刷新中…') : null,
            h('button', { type: 'button', className: 'orch-btn', onClick: () => void orchRefresh(state.runId) }, '刷新'),
            h('button', { type: 'button', className: 'orch-btn orch-btn-quiet', onClick: orchClose, title: '关闭（Esc）' }, '✕'),
          ),
        ),
        state.error ? h('div', { className: 'orch-error', style: { padding: '8px 16px' } }, state.error) : null,
        h(
          'div',
          { className: 'orch-body' },
          compact
            ? h(OrchList, { run, selectedId: state.selectedNodeId, onSelect: orchSelectNode })
            : h(OrchCanvas, { run, selectedId: state.selectedNodeId, onSelect: orchSelectNode }),
          state.selectedNodeId
            ? h(OrchDrawer, {
                run,
                nodeId: state.selectedNodeId,
                detail: state.detail,
                loading: state.detailLoading,
                error: state.detailError,
                onClose: () => {
                  orchStore.selectedNodeId = null
                  orchEmit()
                },
              })
            : null,
        ),
      ),
    ),
  )
}

export function apply(ctx) {
  // 样式装到 document.head：入口按钮先于画布出现，不能等 overlay 渲染才注入 CSS。
  try {
    if (!document.getElementById('dsh-orchestrator-canvas-style')) {
      const style = document.createElement('style')
      style.id = 'dsh-orchestrator-canvas-style'
      style.setAttribute('data-plugin-css', 'dsh-orchestrator-canvas')
      style.textContent = ORCH_CSS
      document.head.appendChild(style)
    }
  } catch (error) {
    console.error('[orchestrator-canvas] 注入样式失败', error)
  }

  // 调试/兜底入口：万一按钮所在槽位被宿主换掉，控制台还能 `__orchCanvas.open()` 打开画布。
  try {
    window.__orchCanvas = {
      open: orchOpen,
      close: orchClose,
      toggle: orchToggle,
      refresh: orchRefresh,
      setSession: orchSetSession,
      pickScope: orchPickScope,
      visible: orchVisibleRuns,
      store: orchStore,
    }
  } catch {
    /* 忽略 */
  }

  try {
    ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        { name: 'conversation.input.left', id: 'orchestrator-canvas-chip', order: 40 },
        OrchChip,
      ),
    )
  } catch (error) {
    console.error('[orchestrator-canvas] 注册输入框入口失败', error)
  }

  try {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'orchestrator-canvas-overlay', order: 900 },
        OrchOverlay,
      ),
    )
  } catch (error) {
    console.error('[orchestrator-canvas] 注册画布浮层失败', error)
  }
}
