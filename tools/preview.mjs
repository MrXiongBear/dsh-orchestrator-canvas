#!/usr/bin/env node
/* ------------------------------------------------------------------
 * tools/preview.mjs · 离线画布预览（6 张 PNG）
 *
 * 目的：在没装插件、没开浏览器会话的情况下，用同一份布局代码把画布画出来，
 * 让人肉眼验收「分列 / 并行纵排 / 状态色 / 连线 / 数字层级」是否对。
 *
 * 做法（不引入任何 npm 依赖）：
 *   1. 用 vm 执行真实的 src/client/style.js 与 src/client/canvas.js，取出
 *      ORCH_CSS 与 orchLayout / orchEdgePath / orchDuration —— 预览用的是
 *      **生产代码本身**，不是复刻，布局漂移会立刻在 PNG 上暴露。
 *   2. 生成 3 个剧本 × 亮/暗 2 主题 = 6 份 HTML。
 *   3. 调本机 Edge/Chrome 的 headless 模式截图成 PNG（离线 file://，无网络）。
 *
 * 用法：node tools/preview.mjs [--out preview]
 * 退出码非 0 = 有截图没生成成功（不会静默交付）。
 * ------------------------------------------------------------------ */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------- 1. 从生产代码里取布局与样式 ---------------- */

const REACT_STUB = {
  createElement: (...args) => ({ args }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: () => ({}),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useReducer: (reducer, initial) => [initial, () => {}],
}

function loadModule(relative, exportLine) {
  const file = path.join(ROOT, relative)
  const source = `${readFileSync(file, 'utf8')}\n;${exportLine}\n`
  const sandbox = { React: REACT_STUB, console, Date, Math, Map, Set, JSON, Number, String, Object, Array }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox, { filename: relative, timeout: 5000 })
  return sandbox
}

const styleBox = loadModule('src/client/style.js', 'globalThis.__css = ORCH_CSS')
const canvasBox = loadModule(
  'src/client/canvas.js',
  `globalThis.__orch = {
    orchLayout, orchEdgePath, orchDuration,
    ORCH_STATUS_TEXT, ORCH_TYPE_TEXT,
    ORCH_NODE_W, ORCH_NODE_H,
  }`,
)

const CSS = styleBox.__css
const LAYOUT = canvasBox.__orch
if (!CSS || !LAYOUT) throw new Error('[preview] 无法从生产代码里取出 ORCH_CSS / 布局函数')

/* ---------------- 2. 主题 token（宿主真实 token 的离线近似） ---------------- */

const THEMES = {
  light: {
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-bg-overlay': '#ffffff',
    '--dsw-alias-bg-layer-1': '#f7f8fa',
    '--dsw-alias-bg-layer-2': '#eef0f3',
    '--dsw-alias-label-primary': '#1f2328',
    '--dsw-alias-label-secondary': '#5c6673',
    '--dsw-alias-border-l1': '#e3e6ea',
    '--dsw-alias-border-l2': '#cfd4da',
    '--dsw-alias-brand-primary': '#3b6ef6',
    '--dsw-alias-state-success-primary': '#1a9f5a',
    '--dsw-alias-state-error-primary': '#d92d20',
    '--dsw-alias-state-warn-primary': '#b7791f',
    '--dsw-alias-state-idle-primary': '#9aa4b0',
  },
  dark: {
    '--dsw-alias-bg-base': '#16181c',
    '--dsw-alias-bg-overlay': '#1d2025',
    '--dsw-alias-bg-layer-1': '#22262c',
    '--dsw-alias-bg-layer-2': '#2a2f36',
    '--dsw-alias-label-primary': '#e8eaed',
    '--dsw-alias-label-secondary': '#9aa4b0',
    '--dsw-alias-border-l1': '#31363d',
    '--dsw-alias-border-l2': '#454c55',
    '--dsw-alias-brand-primary': '#6b9bff',
    '--dsw-alias-state-success-primary': '#3ecf8e',
    '--dsw-alias-state-error-primary': '#ff6b6b',
    '--dsw-alias-state-warn-primary': '#f0b64a',
    '--dsw-alias-state-idle-primary': '#6b7480',
  },
}

/* ---------------- 3. 三个剧本 ---------------- */

const NOW = '2026-10-29T13:20:00+08:00'

function node(id, type, goal, status, extra = {}) {
  return {
    id,
    type,
    goal,
    status,
    evidence: type === 'check' && status === 'done' ? 1 : 0,
    attempts: 1,
    childId: type === 'step' && status !== 'pending' ? `sub-${id}` : null,
    startedAt: status === 'pending' ? null : '2026-10-29T13:10:00+08:00',
    endedAt: status === 'done' || status === 'failed' ? '2026-10-29T13:12:30+08:00' : null,
    ...extra,
  }
}

function run(runId, brief, nodes, edges) {
  return { runId, brief, status: 'active', nodes, edges, counts: countByType(nodes) }
}

function countByType(nodes) {
  const counts = { step: 0, check: 0, merge: 0 }
  for (const item of nodes) counts[item.type] = (counts[item.type] ?? 0) + 1
  return counts
}

const SCENARIOS = [
  {
    name: 'normal',
    title: '正常流程：2 个并行执行 + 各自检查 + 汇合',
    run: run(
      '20261029-normal',
      '给 DSH 插件补一个只读编排画布：先落宿主工具与图校验，再补客户端画布，最后汇合验证。',
      [
        node('plan-graph', 'step', '实现图校验与 run.json 原子写', 'done'),
        node('plan-client', 'step', '实现只读画布与节点抽屉', 'done'),
        node('check-graph', 'check', 'graph.test.mjs ≥12 断言全绿', 'done'),
        node('check-client', 'check', '客户端 bundle 能被宿主 materialize', 'done'),
        node('merge-accept', 'merge', '汇合：accepted 摘要与证据链', 'done'),
      ],
      [
        { from: 'plan-graph', to: 'check-graph' },
        { from: 'plan-client', to: 'check-client' },
        { from: 'check-graph', to: 'merge-accept' },
        { from: 'check-client', to: 'merge-accept' },
      ],
    ),
  },
  {
    name: 'failure',
    title: '含失败：一个执行失败 → 下游标被阻塞',
    run: run(
      '20261029-failure',
      '失败态演示：客户端检查没过，下游汇合应变成被阻塞。',
      [
        node('plan-client', 'step', '实现只读画布与节点抽屉', 'done'),
        node('plan-drawer', 'step', '实现节点抽屉的原始返回展示', 'failed', {
          lastError: '子代理返回的 output 缺少证据字段',
          endedAt: '2026-10-29T13:12:30+08:00',
        }),
        node('check-client', 'check', '客户端 bundle 能被宿主 materialize', 'failed', { lastError: 'materialize 抛错：缺少 apply' }),
        node('merge-accept', 'merge', '汇合：accepted 摘要与证据链', 'blocked', { blockedReason: '上游 plan-drawer 失败' }),
      ],
      [
        { from: 'plan-client', to: 'check-client' },
        { from: 'plan-drawer', to: 'check-client' },
        { from: 'check-client', to: 'merge-accept' },
      ],
    ),
  },
  {
    name: 'parallel',
    title: '含并行：3 个并行执行 + 3 个检查 + 汇合',
    run: run(
      '20261029-parallel',
      '并行度上限 3：三路执行同时跑，各自带检查，最后汇合验收。',
      [
        node('step-a', 'step', '梳理宿主 tools 注册契约', 'done'),
        node('step-b', 'step', '跑通 subagents.startActivation 演示', 'running'),
        node('step-c', 'step', '出 6 张离线预览 PNG', 'done'),
        node('check-a', 'check', 'node --check 与单测全绿', 'done'),
        node('check-b', 'check', '子代理返回值能写回 run.json', 'pending'),
        node('check-c', 'check', '预览图与布局一致', 'pending'),
        node('merge-accept', 'merge', '汇合：交付物清单与证据', 'pending'),
      ],
      [
        { from: 'step-a', to: 'check-a' },
        { from: 'step-b', to: 'check-b' },
        { from: 'step-c', to: 'check-c' },
        { from: 'check-a', to: 'merge-accept' },
        { from: 'check-b', to: 'merge-accept' },
        { from: 'check-c', to: 'merge-accept' },
      ],
    ),
  },
]

/* ---------------- 4. 渲染 ---------------- */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dot(status) {
  return `<span class="orch-dot" data-status="${esc(status)}" aria-hidden="true"></span>`
}

function badge(type) {
  return `<span class="orch-badge" data-type="${esc(type)}">${esc(LAYOUT.ORCH_TYPE_TEXT[type] ?? type)}</span>`
}

function card(entry, place) {
  const duration = LAYOUT.orchDuration(entry.startedAt, entry.endedAt, entry.status)
  const meta = []
  if (entry.childId) meta.push(`<span class="orch-ellipsis" title="${esc(entry.childId)}">↳ ${esc(entry.childId)}</span>`)
  if (entry.evidence > 0) meta.push(`<span>证据 ${entry.evidence}</span>`)
  if (entry.attempts > 1) meta.push(`<span>第 ${entry.attempts} 次</span>`)
  if (duration) meta.push(`<span>${esc(duration)}</span>`)
  if (entry.lastError) meta.push(`<span class="orch-error">有错误</span>`)
  return `<button type="button" class="orch-card" data-status="${esc(entry.status)}" data-selected="false"
      style="left:${place.x}px;top:${place.y}px" title="${esc(entry.goal)}">
      <span class="orch-card-top">${dot(entry.status)}${badge(entry.type)}
        <span class="orch-sub">${esc(LAYOUT.ORCH_STATUS_TEXT[entry.status] ?? entry.status)}</span></span>
      <span class="orch-goal">${esc(entry.goal || entry.id)}</span>
      <span class="orch-card-meta">${meta.join('')}</span>
    </button>`
}

function renderHtml(scenario, themeName) {
  const detail = scenario.run
  const layout = LAYOUT.orchLayout(detail.nodes, detail.edges)
  const paths = detail.edges
    .map((edge) => {
      const from = layout.places.get(edge.from)
      const to = layout.places.get(edge.to)
      if (!from || !to) return ''
      const target = detail.nodes.find((item) => item.id === edge.to)
      return `<path class="orch-edge" data-status="${esc(target ? target.status : 'pending')}" d="${LAYOUT.orchEdgePath(from, to)}"></path>`
    })
    .join('\n')
  const cards = detail.nodes
    .map((entry) => {
      const place = layout.places.get(entry.id)
      return place ? card(entry, place) : ''
    })
    .join('\n')
  const tokens = THEMES[themeName] ?? THEMES.light
  const rootVars = Object.entries(tokens)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN" data-theme="${esc(themeName)}">
<head>
<meta charset="utf-8">
<title>编排画布预览 · ${esc(scenario.name)} · ${esc(themeName)}</title>
<style>
:root {
${rootVars}
}
html, body { margin: 0; padding: 0; background: var(--dsw-alias-bg-base); }
body { padding: 24px; }
/* 预览里冻结动画，保证截图可复现 */
.orch-root * { animation: none !important; }
${CSS}
/* 预览外壳：只负责把面板摆到页面上 */
.preview-shell { display: flex; flex-direction: column; gap: 10px; }
.preview-title { font: 600 14px/1.4 system-ui, sans-serif; color: var(--dsw-alias-label-primary); }
.preview-shell .orch-panel { width: min(1180px, calc(100vw - 96px)); height: min(760px, calc(100vh - 150px)); }
.preview-shell .orch-backdrop { position: static; display: block; background: none; }
.preview-shell .orch-root { position: static; }
</style>
</head>
<body>
<div class="orch-root">
  <div class="preview-shell">
    <div class="preview-title">离线预览 · ${esc(scenario.title)} · ${themeName === 'dark' ? '暗色' : '亮色'}</div>
    <div class="orch-backdrop">
      <div class="orch-panel">
        <div class="orch-head">
          ${dot(detail.status === 'active' ? 'running' : 'pending')}
          <span class="orch-title">编排画布</span>
          <span class="orch-sub orch-ellipsis" title="${esc(detail.brief)}">${esc(detail.brief)}</span>
          <span class="orch-sub">执行 ${detail.counts.step} · 检查 ${detail.counts.check} · 汇合 ${detail.counts.merge}</span>
          <span class="orch-grow"></span>
          <select class="orch-select"><option>${esc(detail.runId)}</option></select>
          <span class="orch-head-actions"><button type="button" class="orch-btn">刷新</button><button type="button" class="orch-btn orch-btn-quiet">✕</button></span>
        </div>
        <div class="orch-body">
          <div class="orch-viewport">
            <div class="orch-stage" style="transform:translate(0px,0px) scale(1);width:${layout.width}px;height:${layout.height}px">
              <svg class="orch-edges" width="${layout.width}" height="${layout.height}" aria-hidden="true">
${paths}
              </svg>
${cards}
            </div>
            <div class="orch-tools">
              <button type="button" class="orch-btn">＋</button>
              <button type="button" class="orch-btn">－</button>
              <button type="button" class="orch-btn">100%</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`
}

/* ---------------- 5. 截图 ---------------- */

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]
  return candidates.find((file) => file && existsSync(file)) ?? null
}

async function screenshot(browser, htmlFile, pngFile, cdpPort) {
  // 用 CDP 驱动 headless 实例截图。
  // 为什么不用 `--screenshot` 单发模式：本机 Edge 在已有实例运行时，spawnSync(--screenshot) 会永久挂住
  // （2026-10-29 实测两次，各挂 5 分钟以上无输出）。CDP 方式还顺带解决了 deviceScaleFactor 不生效的问题。
  // 传 --cdp <port> 可以复用已经在跑的浏览器实例（本机 Edge 存在无法 spawn 出 CDP 的情况时用它）。
  const reuse = Number.isInteger(cdpPort) && cdpPort > 0
  const profileDir = path.join(
    process.env.TEMP ?? process.env.TMP ?? '.',
    `dsh-orch-preview-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  )
  const port = reuse ? cdpPort : 9400 + Math.floor(Math.random() * 400)
  const child = reuse
    ? null
    : spawn(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${profileDir}`,
          `--remote-debugging-port=${port}`,
          '--window-size=1280,900',
          'about:blank',
        ],
        { stdio: 'ignore' },
      )
  const cleanup = () => {
    if (child) {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
    }
    if (!reuse) {
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        /* 忽略 */
      }
    }
  }
  try {
    const deadline = Date.now() + 20_000
    let target = null
    while (Date.now() < deadline) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find((item) => item.type === 'page') ?? null
        if (target) break
      } catch {
        /* 还没起来 */
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!target) throw new Error('CDP target 未就绪')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    })
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`CDP ${method} 15s 无响应`))
        }, 15_000)
        pending.set(id, (message) => {
          clearTimeout(timer)
          resolve(message)
        })
        ws.send(JSON.stringify({ id, method, params }))
      })
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await send('Page.navigate', { url: `file:///${htmlFile.replace(/\\/g, '/')}` })
    await new Promise((resolve) => setTimeout(resolve, 800))
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    const data = shot?.result?.data
    ws.close()
    if (!data) throw new Error('captureScreenshot 没返回数据')
    await writeFile(pngFile, Buffer.from(data, 'base64'))
  } finally {
    cleanup()
  }
}
/* ---------------- main ---------------- */

const outDir = path.resolve(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'preview')
await mkdir(outDir, { recursive: true })
const browser = findBrowser()
if (!browser) throw new Error('[preview] 找不到 Edge/Chrome，无法截图。请安装 Chromium 或用 --html-only 只看 HTML。')

const htmlOnly = process.argv.includes('--html-only')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpPort = cdpIndex >= 0 ? Number(process.argv[cdpIndex + 1]) : 0
const results = []
for (const scenario of SCENARIOS) {
  for (const themeName of ['light', 'dark']) {
    const base = `${scenario.name}-${themeName}`
    const htmlFile = path.join(outDir, `${base}.html`)
    await writeFile(htmlFile, renderHtml(scenario, themeName), 'utf8')
    if (htmlOnly) {
      results.push({ base, htmlFile, pngFile: null })
      continue
    }
    const pngFile = path.join(outDir, `${base}.png`)
    await screenshot(browser, htmlFile, pngFile, cdpPort)
    let bytes = 0
    try {
      bytes = (await stat(pngFile)).size
    } catch {
      bytes = 0
    }
    results.push({ base, htmlFile, pngFile, bytes })
    console.log(`[preview] ${base}.png ${bytes} bytes${bytes > 0 ? '' : '  ← 截图失败'}`)
  }
}

if (!htmlOnly) {
  const broken = results.filter((item) => !item.bytes)
  if (broken.length > 0) {
    console.error(`[preview] ${broken.length} 张 PNG 没生成：${broken.map((item) => item.base).join(', ')}`)
    process.exit(1)
  }
}
console.log(`[preview] ok ${results.length} 份 → ${path.relative(ROOT, outDir)}${htmlOnly ? '（仅 HTML）' : '（PNG 已生成）'}`)
