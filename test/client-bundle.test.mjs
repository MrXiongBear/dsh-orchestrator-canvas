/* ------------------------------------------------------------------
 * test/client-bundle.test.mjs · 客户端接缝测试
 *
 * 这里测的不是「代码看起来对」，而是宿主 client loader 真正要做的事：
 *   - client.js 是否存在、是否能被 vm 真 materialize 成 {id, factory}
 *   - factory 返回 {apply, inject:['slots']}
 *   - 每个模块都登记在 MODULES 表里并出现在产物里（echocat 事故的防线）
 *   - 画布是只读投影：客户端源码里不允许出现写接口
 * ------------------------------------------------------------------ */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { MODULES, buildClient, materialize } from '../tools/build-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('MODULES 表里每个文件都真实存在', () => {
  assert.ok(MODULES.length >= 4, '模块表不应少于 4 个文件')
  for (const relative of MODULES) {
    assert.ok(existsSync(path.join(ROOT, relative)), `缺少模块文件：${relative}`)
  }
})

test('构建产物包含每个模块的 marker（模块漏登记会在这里炸）', async () => {
  const { outFile } = await buildClient()
  const code = await readFile(outFile, 'utf8')
  for (const relative of MODULES) {
    assert.ok(code.includes(`module: ${relative}`), `产物缺少 marker：${relative}`)
  }
  assert.ok(code.includes('window.__ModuleLoader__.load'), '产物必须由 loader 壳包裹')
  assert.ok(!/^\s*import\s/m.test(code), 'factory 体内不允许 import 语句')
})

test('产物能被宿主 loader 契约 materialize，并返回 {apply, inject}', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const { outFile } = await buildClient()
  const code = await readFile(outFile, 'utf8')
  const plugin = await materialize(code, pkg.name)
  assert.equal(plugin.id, pkg.name, '入口 id 必须等于包名')
  assert.ok(plugin.inject.includes('slots'), 'inject 必须包含 slots')
})

test('factory 体内只允许 require("react")', async () => {
  const { outFile } = await buildClient()
  const code = await readFile(outFile, 'utf8')
  const requires = Array.from(code.matchAll(/require\((['"])([^'"]+)\1\)/g)).map((m) => m[2])
  assert.deepEqual([...new Set(requires)], ['react'], `出现了非法 require：${requires.join(', ')}`)
})

test('客户端只读：源码里不存在写状态/写文件的调用', async () => {
  const sources = await Promise.all(MODULES.map((relative) => readFile(path.join(ROOT, relative), 'utf8')))
  const all = sources.join('\n')
  for (const forbidden of ['method: \'POST\'', 'method:"POST"', 'method: \'PUT\'', 'method: \'DELETE\'', 'localStorage.setItem', 'sessionStorage.setItem', 'writeFile']) {
    assert.ok(!all.includes(forbidden), `客户端出现写操作：${forbidden}`)
  }
  assert.ok(all.includes("const ORCH_API = '/_dsh/orchestrator-canvas/api'"), '客户端应只读 host 的 /_dsh/orchestrator-canvas/api 接口')
  assert.ok(all.includes('${ORCH_API}/state'), '客户端应读取 host 的 state 接口')
})

test('package.json 的 dsh 声明完整（bundle patch / client / compatibility / 无 install 脚本）', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.match(pkg.dsh.compatibility.dsh, /0\.2\.1-rc\.2/)
  assert.deepEqual(pkg.dsh.compatibility.profiles, ['desktop'])
  assert.ok(existsSync(path.join(ROOT, 'cordis.patch.yml')), 'cordis.patch.yml 必须存在')
  assert.ok(existsSync(path.join(ROOT, 'client.js')), 'client.js 必须存在')
  assert.ok(!pkg.scripts.install && !pkg.scripts.postinstall, '不允许 install 脚本')
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-tools'].optional, true, '宿主包必须是 optional peer')
})

/* ---------------- 布局：分列 / 并行纵排 / 汇合居中 ---------------- */

const canvasSource = readFileSync(path.join(ROOT, 'src/client/canvas.js'), 'utf8')
const sandbox = {
  React: { createElement: () => null, useEffect() {}, useMemo: (fn) => fn(), useRef: () => ({}), useState: (v) => [v, () => {}], useReducer: (r, i) => [i, () => {}] },
  console,
  Date,
  Math,
  Map,
  Set,
  JSON,
  Number,
  String,
  Object,
  Array,
}
sandbox.globalThis = sandbox
vm.runInNewContext(
  `${canvasSource}\n;globalThis.__orch = { orchLayout, orchDepths, orchEdgePath, ORCH_NODE_H, ORCH_NODE_W }`,
  sandbox,
  { filename: 'canvas.js', timeout: 5000 },
)
const layoutApi = sandbox.__orch

test('布局：按依赖深度分列，同层并行节点纵排', () => {
  const nodes = [
    { id: 'a', type: 'step' },
    { id: 'b', type: 'step' },
    { id: 'ca', type: 'check' },
    { id: 'cb', type: 'check' },
    { id: 'm', type: 'merge' },
  ]
  const edges = [
    { from: 'a', to: 'ca' },
    { from: 'b', to: 'cb' },
    { from: 'ca', to: 'm' },
    { from: 'cb', to: 'm' },
  ]
  const { places, columns } = layoutApi.orchLayout(nodes, edges)
  assert.equal(columns, 3)
  assert.equal(places.get('a').x, places.get('b').x, '同深度的并行节点应同列')
  assert.notEqual(places.get('a').y, places.get('b').y, '同列并行节点必须纵向错开')
  assert.ok(places.get('ca').x > places.get('a').x, '依赖列必须从左到右')
  assert.ok(places.get('m').x > places.get('ca').x)
})

test('布局：汇合节点垂直居中在父节点之间（连线不穿卡片）', () => {
  const nodes = [
    { id: 'a', type: 'step' },
    { id: 'b', type: 'step' },
    { id: 'm', type: 'merge' },
  ]
  const edges = [
    { from: 'a', to: 'm' },
    { from: 'b', to: 'm' },
  ]
  const { places } = layoutApi.orchLayout(nodes, edges)
  const centersY = ['a', 'b'].map((id) => places.get(id).y + layoutApi.ORCH_NODE_H / 2)
  const mergeCenter = places.get('m').y + layoutApi.ORCH_NODE_H / 2
  const average = (centersY[0] + centersY[1]) / 2
  assert.ok(Math.abs(mergeCenter - average) <= layoutApi.ORCH_NODE_H, '汇合节点应接近父节点中心平均值')
})

test('布局：空图不炸，宽高为正', () => {
  const result = layoutApi.orchLayout([], [])
  assert.ok(result.width > 0 && result.height > 0)
  assert.equal(result.places.size, 0)
})
