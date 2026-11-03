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
