/* ------------------------------------------------------------------
 * canvas.js · 只读 DAG 画布
 *
 * 数据只从宿主只读接口来（run.brief），这里不做任何状态写入：
 * 画布是投影，节点状态唯一的写入口是 orch_* 工具。
 *
 * 布局是确定性的：按依赖深度分列（左 → 右），同层节点纵向排列，
 * 卡片固定尺寸 240×112，因此连线坐标可在没有 DOM 测量的情况下算出来。
 * ------------------------------------------------------------------ */

/* 手写 bundler 会把 style → canvas → drawer → index 顺序拼进同一个
 * factory 作用域，这里定义一次 `h`，后面的模块共用。 */
const h = React.createElement

const ORCH_NODE_W = 240
const ORCH_NODE_H = 112
const ORCH_COL_GAP = 76
const ORCH_ROW_GAP = 18
const ORCH_PAD = 24

const ORCH_STATUS_TEXT = {
  pending: '待运行',
  running: '运行中',
  done: '完成',
  failed: '失败',
  blocked: '被阻塞',
}

const ORCH_TYPE_TEXT = { step: '执行', check: '检查', merge: '汇合' }

/** 节点 → 依赖深度（无入边为 0；有环时退化为按出现顺序，不抛错）。 */
function orchDepths(nodes, edges) {
  const ids = nodes.map((n) => n.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const parents = new Map(ids.map((id) => [id, []]))
  for (const edge of edges || []) {
    if (!index.has(edge.from) || !index.has(edge.to)) continue
    parents.get(edge.to).push(edge.from)
  }
  const depth = new Map()
  const visit = (id, seen) => {
    if (depth.has(id)) return depth.get(id)
    if (seen.has(id)) return 0 // 环：不再深入，交给校验层报错
    seen.add(id)
    let value = 0
    for (const parent of parents.get(id) ?? []) {
      value = Math.max(value, visit(parent, seen) + 1)
    }
    seen.delete(id)
    depth.set(id, value)
    return value
  }
  for (const id of ids) visit(id, new Set())
  return depth
}

/** 计算每张卡片的绝对坐标（画布坐标系，未缩放）。
 *
 * 规则：列 = 依赖深度，行内先按类型（执行→检查→汇合）稳定排序；
 * 有父节点的（检查/汇合）尽量垂直居中在父节点之间，再按最小间距下推，
 * 避免连线穿过卡片。
 */
function orchLayout(nodes, edges) {
  const depth = orchDepths(nodes, edges)
  const typeRank = { step: 0, check: 1, merge: 2 }
  const order = nodes.map((n) => n.id)
  const parents = new Map(nodes.map((n) => [n.id, []]))
  for (const edge of edges || []) {
    if (parents.has(edge.to)) parents.get(edge.to).push(edge.from)
  }

  const columns = new Map()
  for (const node of nodes) {
    const d = depth.get(node.id) ?? 0
    if (!columns.has(d)) columns.set(d, [])
    columns.get(d).push(node)
  }

  const places = new Map()
  const colKeys = Array.from(columns.keys()).sort((a, b) => a - b)
  let maxBottom = 0
  for (const d of colKeys) {
    const list = columns.get(d)
    list.sort((a, b) => {
      const diff = (typeRank[a.type] ?? 3) - (typeRank[b.type] ?? 3)
      if (diff !== 0) return diff
      return order.indexOf(a.id) - order.indexOf(b.id)
    })
    // 期望位置：有父节点时对齐父节点中心，否则按序号排。
    const desired = list.map((node, row) => {
      const parentPlaces = (parents.get(node.id) ?? [])
        .map((id) => places.get(id))
        .filter(Boolean)
      if (parentPlaces.length === 0) return ORCH_PAD + row * (ORCH_NODE_H + ORCH_ROW_GAP)
      const center = parentPlaces.reduce((sum, place) => sum + place.y + ORCH_NODE_H / 2, 0) / parentPlaces.length
      return Math.round(center - ORCH_NODE_H / 2)
    })
    const indexed = list.map((node, i) => ({ node, y: desired[i] }))
    indexed.sort((a, b) => a.y - b.y || order.indexOf(a.node.id) - order.indexOf(b.node.id))
    let cursor = ORCH_PAD
    indexed.forEach((entry, row) => {
      const y = Math.max(entry.y, cursor)
      places.set(entry.node.id, {
        x: ORCH_PAD + d * (ORCH_NODE_W + ORCH_COL_GAP),
        y,
        depth: d,
        row,
      })
      cursor = y + ORCH_NODE_H + ORCH_ROW_GAP
      maxBottom = Math.max(maxBottom, y + ORCH_NODE_H)
    })
  }

  const cols = colKeys.length === 0 ? 1 : Math.max(...colKeys) + 1
  return {
    places,
    width: ORCH_PAD * 2 + cols * ORCH_NODE_W + Math.max(0, cols - 1) * ORCH_COL_GAP,
    height: maxBottom + ORCH_PAD,
    columns: cols,
  }
}

/** 父右中 → 子左中的三次贝塞尔。 */
function orchEdgePath(from, to) {
  const x1 = from.x + ORCH_NODE_W
  const y1 = from.y + ORCH_NODE_H / 2
  const x2 = to.x
  const y2 = to.y + ORCH_NODE_H / 2
  const bend = Math.max(36, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function orchMs(startedAt, endedAt) {
  if (!startedAt) return null
  const from = Date.parse(startedAt)
  if (Number.isNaN(from)) return null
  const to = endedAt ? Date.parse(endedAt) : Date.now()
  if (Number.isNaN(to)) return null
  return Math.max(0, to - from)
}

function orchDuration(startedAt, endedAt, status) {
  const ms = orchMs(startedAt, endedAt)
  if (ms == null) return null
  if (status !== 'running' && !endedAt) return null
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, '0')}s`
}

function OrchDot(props) {
  return h('span', { className: 'orch-dot', 'data-status': props.status, 'aria-hidden': 'true' })
}

function OrchBadge(props) {
  return h('span', { className: 'orch-badge', 'data-type': props.type }, ORCH_TYPE_TEXT[props.type] ?? props.type)
}

function OrchNodeCard(props) {
  const { node, place, selected, onSelect } = props
  const duration = orchDuration(node.startedAt, node.endedAt, node.status)
  const meta = []
  if (node.childId) meta.push(h('span', { key: 'child', className: 'orch-ellipsis', title: node.childId }, `↳ ${node.childId}`))
  if (node.evidence > 0) meta.push(h('span', { key: 'ev' }, `证据 ${node.evidence}`))
  if (node.attempts > 1) meta.push(h('span', { key: 'at' }, `第 ${node.attempts} 次`))
  if (duration) meta.push(h('span', { key: 'du' }, duration))
  if (node.lastError) meta.push(h('span', { key: 'err', className: 'orch-error' }, '有错误'))
  return h(
    'button',
    {
      type: 'button',
      className: 'orch-card',
      'data-status': node.status,
      'data-selected': selected ? 'true' : 'false',
      style: { left: `${place.x}px`, top: `${place.y}px` },
      title: node.goal,
      onClick: () => onSelect(node.id),
    },
    h(
      'span',
      { className: 'orch-card-top' },
      h(OrchDot, { status: node.status }),
      h(OrchBadge, { type: node.type }),
      h('span', { className: 'orch-sub' }, ORCH_STATUS_TEXT[node.status] ?? node.status),
    ),
    h('span', { className: 'orch-goal' }, node.goal || node.id),
    h('span', { className: 'orch-card-meta' }, meta),
  )
}

/** 窄屏降级视图：单列列表，点击同样开抽屉。 */
function OrchList(props) {
  const { run, selectedId, onSelect } = props
  if (!run) {
    return h('div', { className: 'orch-empty' }, '还没有编排运行')
  }
  return h(
    'div',
    { className: 'orch-list' },
    ...run.nodes.map((node) =>
      h(
        'button',
        {
          key: node.id,
          type: 'button',
          className: 'orch-list-item',
          'data-selected': node.id === selectedId ? 'true' : 'false',
          onClick: () => onSelect(node.id),
        },
        h(OrchDot, { status: node.status }),
        h(
          'span',
          { className: 'orch-grow' },
          h('span', { className: 'orch-goal' }, node.goal || node.id),
          h(
            'span',
            { className: 'orch-card-meta' },
            h(OrchBadge, { type: node.type }),
            h('span', null, ORCH_STATUS_TEXT[node.status] ?? node.status),
            node.evidence > 0 ? h('span', null, `证据 ${node.evidence}`) : null,
            orchDuration(node.startedAt, node.endedAt, node.status)
              ? h('span', null, orchDuration(node.startedAt, node.endedAt, node.status))
              : null,
          ),
        ),
      ),
    ),
  )
}

/** 画布本体：缩放 + 平移 + 连线 + 卡片。 */
function OrchCanvas(props) {
  const { run, selectedId, onSelect } = props
  const [zoom, setZoom] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const [panning, setPanning] = React.useState(false)
  const dragRef = React.useRef(null)
  const viewportRef = React.useRef(null)

  const layout = React.useMemo(
    () => (run ? orchLayout(run.nodes, run.edges) : { places: new Map(), width: 0, height: 0, columns: 0 }),
    [run],
  )

  // 切换 run 时复位视口，避免沿用上一张图的位置。
  React.useEffect(() => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }, [run && run.runId])

  const clampZoom = (value) => Math.min(1.8, Math.max(0.45, Math.round(value * 100) / 100))

  const onWheel = (event) => {
    if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 1) return
    event.preventDefault()
    setZoom((z) => clampZoom(z - Math.sign(event.deltaY) * 0.12))
  }

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    if (event.target && event.target.closest && event.target.closest('.orch-card')) return
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    setPanning(true)
    if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({ x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) })
  }
  const stopPan = () => {
    dragRef.current = null
    setPanning(false)
  }

  const resetView = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  if (!run) {
    return h('div', { className: 'orch-empty' }, h('span', null, '还没有编排运行'), h('span', { className: 'orch-sub' }, '让主智能体先用 orch_plan 建一张图'))
  }

  const edges = (run.edges || []).map((edge, i) => {
    const from = layout.places.get(edge.from)
    const to = layout.places.get(edge.to)
    if (!from || !to) return null
    const target = (run.nodes || []).find((n) => n.id === edge.to)
    return h('path', {
      key: `e${i}`,
      className: 'orch-edge',
      'data-status': target ? target.status : 'pending',
      d: orchEdgePath(from, to),
    })
  })

  const stageStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
  }

  return h(
    'div',
    {
      className: 'orch-viewport',
      ref: viewportRef,
      'data-panning': panning ? 'true' : 'false',
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp: stopPan,
      onPointerCancel: stopPan,
      onPointerLeave: stopPan,
    },
    h(
      'div',
      { className: 'orch-stage', style: stageStyle },
      h(
        'svg',
        { className: 'orch-edges', width: layout.width, height: layout.height, 'aria-hidden': 'true' },
        ...edges,
      ),
      ...run.nodes.map((node) => {
        const place = layout.places.get(node.id)
        if (!place) return null
        return h(OrchNodeCard, {
          key: node.id,
          node,
          place,
          selected: node.id === selectedId,
          onSelect,
        })
      }),
    ),
    h(
      'div',
      { className: 'orch-tools' },
      h('button', { type: 'button', className: 'orch-btn', onClick: () => setZoom((z) => clampZoom(z + 0.15)), title: '放大' }, '＋'),
      h('button', { type: 'button', className: 'orch-btn', onClick: () => setZoom((z) => clampZoom(z - 0.15)), title: '缩小' }, '－'),
      h('button', { type: 'button', className: 'orch-btn', onClick: resetView, title: '复位视图' }, `${Math.round(zoom * 100)}%`),
    ),
  )
}
