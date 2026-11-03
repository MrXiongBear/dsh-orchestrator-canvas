/* 由 tools/build-client.mjs 生成，勿手改。模块表见该文件 MODULES。 */
window.__ModuleLoader__.load({
  id: "dsh-orchestrator-canvas",
  factory: function (require) {
    'use strict'
    const React = require('react')
/* ---- module: src/client/style.js ---- */
/* ------------------------------------------------------------------
 * style.js · 画布的全部样式
 *
 * 只使用宿主主题 token（--dsw-alias-*），亮/暗主题自动跟随；
 * 字号全部 ≥ 12px，中文字体走宿主 inherit。
 * 本文件由 tools/build-client.mjs 按顺序拼进 client.js，因此这里
 * 只声明常量，不 import 任何东西、也没有副作用。
 * ------------------------------------------------------------------ */

const ORCH_CSS = `
.orch-root, .orch-root * { box-sizing: border-box; }
.orch-root {
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}

/* ---- 遮罩与面板 ---- */
.orch-backdrop {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 宿主浮层本身是 click-through，入口必须自己打开指针事件并压在最高层。 */
  pointer-events: auto;
  z-index: 2147483000;
}
.orch-panel {
  width: min(1180px, calc(100vw - 96px));
  height: min(760px, calc(100vh - 96px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.orch-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
}
.orch-title { font-size: 14px; font-weight: 600; white-space: nowrap; flex: 0 0 auto; }
.orch-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.orch-grow { flex: 1 1 auto; min-width: 0; }
.orch-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; white-space: nowrap; }

/* ---- 按钮 ---- */
.orch-btn {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.orch-btn:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.orch-btn:active { transform: translateY(1px); }
.orch-btn[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.orch-btn-quiet { border-color: transparent; background: transparent; }
.orch-select {
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  max-width: 320px;
}
/* 运行范围切换：本会话 / 本工作区 / 全部。 */
.orch-scope {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  flex: 0 0 auto;
  white-space: nowrap;
}
.orch-scope-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.4;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.orch-scope-btn:hover { color: var(--dsw-alias-label-primary); }
.orch-scope-btn[data-active='true'] {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.orch-note { font-size: 12px; color: var(--dsw-alias-label-secondary); }

/* ---- 画布视口 ---- */
.orch-body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
.orch-viewport {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, var(--dsw-alias-border-l1) 1px, transparent 0) 0 0 / 22px 22px,
    var(--dsw-alias-bg-layer-1);
  cursor: grab;
}
.orch-viewport[data-panning="true"] { cursor: grabbing; }
.orch-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.orch-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.orch-edge {
  fill: none;
  stroke: var(--dsw-alias-border-l2);
  stroke-width: 1.5;
}
.orch-edge[data-status="running"] { stroke: var(--dsw-alias-brand-primary); stroke-dasharray: 5 4; animation: orch-dash 900ms linear infinite; }
.orch-edge[data-status="done"] { stroke: var(--dsw-alias-state-success-primary); opacity: 0.75; }
.orch-edge[data-status="failed"] { stroke: var(--dsw-alias-state-error-primary); opacity: 0.8; }
.orch-edge[data-status="blocked"] { stroke: var(--dsw-alias-state-warn-primary); opacity: 0.7; stroke-dasharray: 3 5; }
@keyframes orch-dash { to { stroke-dashoffset: -18; } }

/* ---- 节点卡片 ---- */
.orch-card {
  position: absolute;
  width: 240px;
  height: 112px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.orch-card:hover { border-color: var(--dsw-alias-border-l2); transform: translateY(-1px); }
.orch-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.orch-card[data-selected="true"] { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary) inset; }
.orch-card[data-status="failed"] { border-color: var(--dsw-alias-state-error-primary); }
.orch-card[data-status="blocked"] { border-color: var(--dsw-alias-state-warn-primary); }
.orch-card-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.orch-goal {
  font-size: 13px;
  font-weight: 500;
  flex: 0 0 auto;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;
  word-break: break-word;
}
.orch-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  flex: 0 0 auto;
  flex-wrap: nowrap;
  min-width: 0;
}
.orch-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto; }
.orch-card-meta > *:not(.orch-ellipsis) { flex: 0 0 auto; }

/* ---- 状态点 ---- */
.orch-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--dsw-alias-state-idle-primary); }
.orch-dot[data-status="running"] { background: var(--dsw-alias-brand-primary); animation: orch-pulse 1.4s ease-in-out infinite; }
.orch-dot[data-status="done"] { background: var(--dsw-alias-state-success-primary); }
.orch-dot[data-status="failed"] { background: var(--dsw-alias-state-error-primary); }
.orch-dot[data-status="blocked"] { background: var(--dsw-alias-state-warn-primary); }
@keyframes orch-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--dsw-alias-brand-primary) 0%, transparent); }
}

/* ---- 徽标 ---- */
.orch-badge {
  font-size: 12px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  flex: 0 0 auto;
}
.orch-badge[data-type="step"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
.orch-badge[data-type="check"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); }
.orch-badge[data-type="merge"] { color: var(--dsw-alias-label-secondary); }

/* ---- 画布工具条 ---- */
.orch-tools {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  gap: 6px;
  padding: 6px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  z-index: 3;
}
.orch-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  pointer-events: none;
}

/* ---- 抽屉 ---- */
.orch-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 46%);
  z-index: 6;
  box-shadow: -10px 0 28px rgba(0, 0, 0, 0.10);
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.orch-drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.orch-drawer-body { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.orch-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.orch-field {
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 260px;
  overflow: auto;
}
.orch-evidence { display: flex; flex-direction: column; gap: 6px; }
.orch-evidence-row {
  display: flex;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 12px;
}
.orch-evidence-kind { color: var(--dsw-alias-brand-primary); flex: 0 0 auto; }
.orch-warn { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.orch-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }

/* ---- 窄屏列表视图 ---- */
.orch-list { position: absolute; inset: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.orch-list-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  cursor: pointer;
  text-align: left;
}
.orch-list-item[data-selected="true"] { border-color: var(--dsw-alias-brand-primary); }

/* ---- 输入框旁的入口点 ---- */
.orch-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
}
.orch-chip:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.orch-chip[data-open="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.orch-chip-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
`

/* 窄屏断点：宿主面板窄于 820px 时降级为列表视图（规格要求）。 */
const ORCH_COMPACT_QUERY = '(max-width: 820px)'

/* ---- module: src/client/canvas.js ---- */
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

/* ---- module: src/client/drawer.js ---- */
/* ------------------------------------------------------------------
 * drawer.js · 节点抽屉
 *
 * 展示一个节点的全量证据：run.brief、派给子代理的 prompt、
 * 子代理原始返回、证据列表、失败原因。只读；不提供任何改状态的按钮。
 * ------------------------------------------------------------------ */

function OrchField(props) {
  if (!props.value) return null
  return h(
    'div',
    null,
    h('div', { className: 'orch-field-label' }, props.label),
    h('div', { className: 'orch-field', style: props.mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : null }, props.value),
  )
}

function OrchEvidenceList(props) {
  // 注意：/api/state 里的节点摘要把 evidence 压成条数（number），只有抽屉拉到的
  // 完整 run.json 才是证据数组。两种形状都要能吃，否则首次渲染（详情未到）会崩。
  const raw = props.evidence
  if (typeof raw === 'number') {
    return h('div', { className: 'orch-sub' }, raw > 0 ? `证据 ${raw} 条（详情加载后显示全文）` : '没有证据：空证据不算通过')
  }
  const list = Array.isArray(raw) ? raw : []
  if (list.length === 0) {
    return h('div', { className: 'orch-warn' }, '没有证据：空证据不算通过')
  }
  return h(
    'div',
    { className: 'orch-evidence' },
    ...list.map((item, i) =>
      h(
        'div',
        { key: `ev${i}`, className: 'orch-evidence-row' },
        h('span', { className: 'orch-evidence-kind' }, item.kind),
        h(
          'span',
          { className: 'orch-grow' },
          h('div', { style: { wordBreak: 'break-word' } }, item.value),
          h('div', { className: 'orch-sub' }, `${item.author ?? 'model'}${item.at ? ` · ${item.at}` : ''}`),
        ),
      ),
    ),
  )
}

function OrchDrawer(props) {
  const { run, nodeId, detail, loading, error, onClose } = props
  const briefNode = run ? (run.nodes || []).find((n) => n.id === nodeId) : null
  const fullRun = detail && detail.runId === (run && run.runId) ? detail : null
  const fullNode = fullRun ? (fullRun.nodes || []).find((n) => n.id === nodeId) : null
  const node = fullNode ?? briefNode
  const lastAttempt = node && node.attempts && node.attempts.length > 0 ? node.attempts[node.attempts.length - 1] : null

  if (!nodeId || !node) {
    return h(
      'aside',
      { className: 'orch-drawer' },
      h('div', { className: 'orch-drawer-head' }, h('span', { className: 'orch-title' }, '节点详情')),
      h('div', { className: 'orch-drawer-body' }, h('div', { className: 'orch-sub' }, '点选画布上的节点查看证据')),
    )
  }

  return h(
    'aside',
    { className: 'orch-drawer', 'aria-label': '节点详情' },
    h(
      'div',
      { className: 'orch-drawer-head' },
      h(OrchDot, { status: node.status }),
      h('span', { className: 'orch-title' }, node.id),
      h(OrchBadge, { type: node.type }),
      h('span', { className: 'orch-sub' }, ORCH_STATUS_TEXT[node.status] ?? node.status),
      h('span', { className: 'orch-grow' }),
      h('button', { type: 'button', className: 'orch-btn orch-btn-quiet', onClick: onClose, title: '关闭抽屉' }, '✕'),
    ),
    h(
      'div',
      { className: 'orch-drawer-body' },
      loading ? h('div', { className: 'orch-sub' }, '读取节点详情…') : null,
      error ? h('div', { className: 'orch-error' }, error) : null,
      h(OrchField, { label: '目标', value: node.goal }),
      node.verdict ? h(OrchField, { label: '判定', value: node.verdict === 'pass' ? '通过（pass）' : '失败（fail）' }) : null,
      h(OrchField, { label: '本轮 brief', value: run && run.brief }),
      node.blockedReason ? h(OrchField, { label: '被阻塞原因', value: node.blockedReason }) : null,
      node.lastError ? h(OrchField, { label: '失败原因', value: node.lastError }) : null,
      h(OrchField, { label: '派发 prompt', value: lastAttempt ? lastAttempt.prompt : null, mono: true }),
      h(OrchField, {
        label: '子代理标识',
        value: (lastAttempt && lastAttempt.childId) || node.childId || null,
        mono: true,
      }),
      h(OrchField, {
        label: lastAttempt && lastAttempt.stopReason ? `子代理原始返回（${lastAttempt.stopReason}）` : '子代理原始返回',
        value: lastAttempt ? (lastAttempt.error ? `错误：${lastAttempt.error}` : lastAttempt.output) : null,
        mono: true,
      }),
      h('div', null, h('div', { className: 'orch-field-label' }, '证据'), h(OrchEvidenceList, { evidence: node.evidence })),
      node.attempts && node.attempts.length > 0
        ? h(
            'div',
            null,
            h('div', { className: 'orch-field-label' }, `尝试记录（${node.attempts.length}）`),
            h(
              'div',
              { className: 'orch-evidence' },
              ...node.attempts.map((attempt) =>
                h(
                  'div',
                  { key: `at${attempt.attempt}`, className: 'orch-evidence-row' },
                  h('span', { className: 'orch-evidence-kind' }, `#${attempt.attempt}`),
                  h('span', { className: 'orch-grow' }, attempt.error ? `失败：${attempt.error}` : `完成（${attempt.stopReason ?? '未知'}）`),
                  h('span', { className: 'orch-sub' }, attempt.at ? String(attempt.at).slice(11, 19) : ''),
                ),
              ),
            ),
          )
        : null,
    ),
  )
}

/* ---- module: src/client/index.js ---- */
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

function apply(ctx) {
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

    return { inject: ['slots'], apply: apply }
  },
})
