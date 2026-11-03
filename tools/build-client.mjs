#!/usr/bin/env node
/* ------------------------------------------------------------------
 * tools/build-client.mjs · 手写客户端 bundler
 *
 * 教训（2026-10-29 echocat 崩溃）：手写 bundler 有「显式模块表」，
 * 新增文件不登记就找不到模块，客户端 entry 直接 import 失败并连坐整个
 * profile。所以这里的 MODULES 是唯一事实来源，且每次构建都做自检：
 *   1. 每个登记文件必须存在且被拼进产物；
 *   2. 产物必须包含每个模块的 marker 注释；
 *   3. 产物里不允许出现 import/export 语句（factory 体内不是模块）；
 *   4. 产物必须能被 vm 真 materialize（--verify），返回 {apply, inject}。
 *
 * 用法：
 *   node tools/build-client.mjs            # 构建 client.js
 *   node tools/build-client.mjs --verify   # 构建后立刻在 vm 里 materialize 校验
 * ------------------------------------------------------------------ */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 唯一的模块表：顺序即拼接顺序（后者可引用前者的声明）。 */
export const MODULES = [
  'src/client/style.js',
  'src/client/canvas.js',
  'src/client/drawer.js',
  'src/client/index.js',
]

/** 构建产物里必须出现的函数名：少一个就说明某个模块没被拼进来。 */
const REQUIRED_SYMBOLS = [
  ['ORCH_CSS', 'src/client/style.js'],
  ['OrchCanvas', 'src/client/canvas.js'],
  ['OrchList', 'src/client/canvas.js'],
  ['OrchDrawer', 'src/client/drawer.js'],
  ['OrchChip', 'src/client/index.js'],
  ['OrchOverlay', 'src/client/index.js'],
]

function fail(message) {
  throw new Error(`[build-client] ${message}`)
}

/** factory 体内不允许 ESM 语法；把 index.js 顶层的 `export ` 去掉。 */
function stripEsm(source, file) {
  if (/^\s*import\s/m.test(source)) fail(`${file} 里有 import 语句，factory 体内不支持`)
  if (/\bexport\s+default\b/.test(source)) fail(`${file} 里有 export default，factory 体内不支持`)
  return source.replace(/^export\s+(async\s+)?function\s/gm, (_m, asyncWord) => `${asyncWord ?? ''}function `)
}

export async function buildClient({ verify = false } = {}) {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const chunks = []
  for (const relative of MODULES) {
    const file = path.join(ROOT, relative)
    if (!existsSync(file)) fail(`模块表里的文件不存在：${relative}`)
    const source = stripEsm(await readFile(file, 'utf8'), relative)
    chunks.push(`/* ---- module: ${relative} ---- */\n${source.trim()}\n`)
  }
  const body = chunks.join('\n')
  for (const [symbol, owner] of REQUIRED_SYMBOLS) {
    if (!body.includes(symbol)) fail(`产物缺少 ${symbol}（应来自 ${owner}），模块表与源文件不一致`)
  }
  if (!/^const h = React\.createElement$/m.test(body)) fail('产物缺少 `const h = React.createElement`')

  const code = `/* 由 tools/build-client.mjs 生成，勿手改。模块表见该文件 MODULES。 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: function (require) {
    'use strict'
    const React = require('react')
${body}
    return { inject: ['slots'], apply: apply }
  },
})
`
  const outFile = path.join(ROOT, 'client.js')
  await writeFile(outFile, code, 'utf8')

  // 自检：产物里每个模块都必须有 marker。
  for (const relative of MODULES) {
    if (!code.includes(`module: ${relative}`)) fail(`产物缺少模块 marker：${relative}`)
  }
  if (/\bimport\s+[\w{*]/.test(body)) fail('产物里仍存在 import 语句')

  if (verify) await materialize(code, pkg.name)
  return { outFile, bytes: Buffer.byteLength(code), modules: MODULES.length }
}

/**
 * 在 vm 里真实执行 loader 壳：这正是宿主 client loader 的契约动作。
 * 这里只提供 window/require，不碰 DOM，能抓到「模块漏登记 / id 不匹配」。
 */
export async function materialize(code, expectedId) {
  const vm = await import('node:vm')
  const registered = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          registered.push(entry)
        },
      },
    },
    require(id) {
      if (id === 'react') return { createElement: () => null, useEffect: () => {}, useState: () => [null, () => {}], useRef: () => ({}), useMemo: (fn) => fn(), useReducer: () => [0, () => {}] }
      throw new Error(`客户端 factory 只允许 require('react')，实际请求了 ${id}`)
    },
    fetch: () => promise404(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }

  function promise404() {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false, error: 'no host' }) })
  }

  vm.runInNewContext(code, sandbox, { filename: 'client.js', timeout: 5000 })
  if (registered.length !== 1) fail(`期望注册 1 个客户端入口，实际 ${registered.length}`)
  const entry = registered[0]
  if (entry.id !== expectedId) fail(`客户端入口 id=${entry.id}，与包名 ${expectedId} 不一致`)
  const factory = entry.factory
  if (typeof factory !== 'function') fail('客户端入口缺少 factory 函数')
  const plugin = factory(sandbox.require)
  if (!plugin || typeof plugin !== 'object') fail('factory 没有返回对象')
  if (typeof plugin.apply !== 'function') fail('factory 返回值缺少 apply')
  if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots')) fail('factory 返回值缺少 inject: [\'slots\']')
  return { id: entry.id, inject: plugin.inject }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verify = process.argv.includes('--verify')
  const result = await buildClient({ verify })
  const relative = path.relative(ROOT, result.outFile)
  console.log(`[build-client] ok ${relative} ${result.bytes} bytes from ${result.modules} modules${verify ? ' (materialized in vm)' : ''}`)
}
