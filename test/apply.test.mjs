// 接缝测试：真实 materialize 宿主入口（apply），用 stub ctx / stub subagents / stub userQuestions
// 覆盖：plan→dispatch→verify→merge 自动汇合（含 merge 事件）、accept 拒绝落事件、accept 成功落盘。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/index.js'

const STEP_OUTPUT = '子代理回执：这一步做完了。'

function makeHarness({ accept = false } = {}) {
  const tools = new Map()
  const asked = []
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'subagents') {
        return {
          list: () => ['stub-provider'],
          startActivation: async (spec) => {
            assert.equal(spec.provider, 'stub-provider')
            assert.ok(Array.isArray(spec.request.prompt))
            return { childId: 'child-stub-1', result: Promise.resolve({ output: [{ type: 'text', text: STEP_OUTPUT }], stopReason: 'completed' }) }
          },
        }
      }
      if (name === 'sessions') {
        return { get: (id) => (id === 'root-agent' ? { header: { cwd: 'E:/proj/one' } } : null) }
      }
      if (name === 'userQuestions') {
        return {
          ask: async (payload) => {
            asked.push(payload)
            return { answers: [{ id: 'accept', selected: accept ? ['确认交付'] : ['还要改'] }] }
          },
        }
      }
      return undefined
    },
    tools: {
      register(definition) {
        assert.equal(tools.has(definition.name), false, `重复注册工具 ${definition.name}`)
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(fn) {
      const dispose = fn()
      return () => (typeof dispose === 'function' ? dispose() : undefined)
    },
    inject(names, cb) {
      cb({
        effect: (fn) => fn(),
        webServer: {
          register: (route) => {
            routes.set(route.path, route.handler)
            return () => routes.delete(route.path)
          },
        },
      })
    },
  }
  return { ctx, tools, asked, routes }
}

function readEvents(dir, runId) {
  const file = join(dir, runId, 'events.jsonl')
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function makeRunsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-apply-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

const exec = { agent: { id: 'root-agent' }, signal: undefined, cwd: process.cwd() }

async function runFixture(graph) {
  const { dir, cleanup } = makeRunsDir()
  const { ctx, tools, asked, routes } = makeHarness({ accept: true })
  apply(ctx, { runsDir: dir, autoPrune: false, subagentProvider: 'stub-provider' })
  for (const name of ['orch_plan', 'orch_dispatch', 'orch_verify', 'orch_accept', 'orch_state']) {
    assert.ok(tools.has(name), `apply 应该注册 ${name}`)
  }
  const plan = await tools.get('orch_plan').execute({ ...graph }, exec)
  return { dir, cleanup, tools, asked, routes, plan }
}

test('apply 注册 5 个工具且 plan 返回分层', async () => {
  const graph = {
    task: '任务原话',
    brief: '等义改写后的目标与验收标准',
    nodes: [
      { id: 'n1', type: 'step', goal: '干活' },
      { id: 'c1', type: 'check', goal: '判定' },
      { id: 'm1', type: 'merge', goal: '汇合' },
    ],
    edges: [
      { from: 'n1', to: 'c1' },
      { from: 'c1', to: 'm1' },
    ],
  }
  const { dir, cleanup, plan } = await runFixture(graph)
  try {
    assert.ok(plan.order.includes('n1'))
    assert.deepEqual(plan.layers, [['n1'], ['c1'], ['m1']])
    assert.deepEqual(plan.dispatchable, ['n1'])
    assert.ok(existsSync(join(dir, plan.runId, 'run.json')))
    // 归属：run 必须记住是哪个会话、在哪个目录下发的（画布「本会话/本工作区」过滤靠它）。
    assert.equal(plan.sessionId, 'root-agent')
    assert.equal(plan.cwd, process.cwd())
    const saved = JSON.parse(readFileSync(join(dir, plan.runId, 'run.json'), 'utf8'))
    assert.equal(saved.sessionId, 'root-agent')
    assert.equal(saved.cwd, process.cwd())
  } finally {
    cleanup()
  }
})

test('dispatch → verify pass → merge 自动汇合且落 merge 事件（可审计）', async () => {
  const graph = {
    task: '任务原话',
    brief: '等义改写后的目标与验收标准',
    nodes: [
      { id: 'n1', type: 'step', goal: '干活' },
      { id: 'c1', type: 'check', goal: '判定' },
      { id: 'm1', type: 'merge', goal: '汇合' },
    ],
    edges: [
      { from: 'n1', to: 'c1' },
      { from: 'c1', to: 'm1' },
    ],
  }
  const { dir, cleanup, tools, plan } = await runFixture(graph)
  try {
    const dispatched = await tools.get('orch_dispatch').execute({ runId: plan.runId, nodeId: 'n1', subagentPrompt: '做 n1' }, exec)
    assert.equal(dispatched.status, 'done')

    const verified = await tools.get('orch_verify').execute(
      { runId: plan.runId, nodeId: 'c1', verdict: 'pass', evidence: [{ kind: 'command', value: 'exit 0：命令输出可复核', author: 'child-stub-1' }] },
      exec,
    )
    assert.equal(verified.verdict, 'pass')
    assert.equal(verified.gaps.length, 0, `不该还有缺口：${verified.gaps.join('；')}`)

    const events = readEvents(dir, plan.runId)
    const kinds = events.map((e) => e.kind)
    assert.ok(kinds.includes('merge'), `汇合必须落事件，实际：${kinds.join(',')}`)
    const mergeEvent = events.find((e) => e.kind === 'merge')
    assert.equal(mergeEvent.nodeId, 'm1')
    assert.deepEqual(mergeEvent.detail.parents, ['c1'])

    const state = await tools.get('orch_state').execute({ runId: plan.runId }, exec)
    const mergeNode = state.run.nodes.find((n) => n.id === 'm1')
    assert.equal(mergeNode.status, 'done')
  } finally {
    cleanup()
  }
})

test('check 判 fail 会把下游标 blocked，accept 拒绝并落 accept-rejected 事件', async () => {
  const graph = {
    task: '负例',
    brief: '验证失败传播与拒绝',
    nodes: [
      { id: 'f1', type: 'step', goal: '干活' },
      { id: 'g1', type: 'check', goal: '判定' },
      { id: 'm1', type: 'merge', goal: '下游汇合' },
    ],
    edges: [
      { from: 'f1', to: 'g1' },
      { from: 'g1', to: 'm1' },
    ],
  }
  const { dir, cleanup, tools, plan } = await runFixture(graph)
  try {
    await tools.get('orch_dispatch').execute({ runId: plan.runId, nodeId: 'f1', subagentPrompt: '做 f1' }, exec)
    const verified = await tools.get('orch_verify').execute(
      { runId: plan.runId, nodeId: 'g1', verdict: 'fail', evidence: [{ kind: 'review', value: '故意判失败：验证传播', author: 'root-agent' }] },
      exec,
    )
    assert.equal(verified.verdict, 'fail')
    assert.ok(verified.blocked.includes('m1'), `下游 m1 应被标 blocked，实际 ${JSON.stringify(verified.blocked)}`)
    assert.ok(verified.retryPrompt.includes('f1'), '应给出重跑 f1 的补丁')

    const rejected = await tools.get('orch_accept').execute({ runId: plan.runId, summary: '假装交付' }, exec)
    assert.equal(rejected.ok, false)
    assert.ok(rejected.missing.some((g) => g.includes('f1')), `拒绝清单应点名 f1：${rejected.missing.join('；')}`)
    assert.ok(rejected.missing.some((g) => g.includes('m1')), `拒绝清单应点名被阻塞的 m1：${rejected.missing.join('；')}`)

    const events = readEvents(dir, plan.runId)
    assert.ok(
      events.some((e) => e.kind === 'accept-rejected'),
      `拒绝必须落事件，实际：${events.map((e) => e.kind).join(',')}`,
    )
    const state = await tools.get('orch_state').execute({ runId: plan.runId }, exec)
    assert.equal(state.run.nodes.find((n) => n.id === 'm1').status, 'blocked')
  } finally {
    cleanup()
  }
})

test('闸门全过后 accept 弹确认并落 accepted（用户选"还要改"则不落）', async () => {
  const graph = {
    task: '需求',
    brief: '目标与验收标准',
    nodes: [
      { id: 'n1', type: 'step', goal: '干活' },
      { id: 'c1', type: 'check', goal: '判定' },
    ],
    edges: [{ from: 'n1', to: 'c1' }],
  }
  const { dir, cleanup, tools, asked, plan } = await runFixture(graph)
  try {
    await tools.get('orch_dispatch').execute({ runId: plan.runId, nodeId: 'n1', subagentPrompt: '做 n1' }, exec)
    await tools.get('orch_verify').execute(
      { runId: plan.runId, nodeId: 'c1', verdict: 'pass', evidence: [{ kind: 'test', value: 'node --test: pass 35 / fail 0', author: 'child-stub-1' }] },
      exec,
    )
    const accepted = await tools.get('orch_accept').execute({ runId: plan.runId, summary: '交付物 A → n1 → 证据 test 35/0' }, exec)
    assert.equal(asked.length, 1, '应当向用户弹一次确认卡片')
    assert.equal(accepted.ok, true)
    assert.ok(accepted.digest.includes('n1'))

    const run = JSON.parse(readFileSync(join(dir, plan.runId, 'run.json'), 'utf8'))
    assert.equal(run.status, 'accepted')
    assert.ok(run.acceptance.acceptedAt)
    assert.ok(readEvents(dir, plan.runId).some((e) => e.kind === 'accept'))
  } finally {
    cleanup()
  }
})

test('/api/state 带 session 时回传会话工作区上下文，runs 带归属字段', async () => {
  const graph = {
    task: '需求',
    brief: '目标与验收标准',
    nodes: [
      { id: 'n1', type: 'step', goal: '干活' },
      { id: 'c1', type: 'check', goal: '判定' },
    ],
    edges: [{ from: 'n1', to: 'c1' }],
  }
  const { dir, cleanup, routes, plan } = await runFixture(graph)
  try {
    const entry = [...routes.entries()].find(([path]) => path.startsWith('/_dsh/orchestrator-canvas'))
    assert.ok(entry, 'apply 应当注册 /_dsh/orchestrator-canvas 前缀路由')
    const [prefix, handler] = entry
    const call = (url) =>
      new Promise((resolve, reject) => {
        const res = {
          statusCode: 0,
          headers: {},
          setHeader(key, value) {
            this.headers[key] = value
          },
          end(body) {
            try {
              resolve({ status: this.statusCode, body: JSON.parse(body) })
            } catch (error) {
              reject(error)
            }
          },
        }
        handler({ method: 'GET', url }, res).catch(reject)
      })

    const withSession = await call(`${prefix}/api/state?session=root-agent`)
    assert.equal(withSession.status, 200)
    assert.deepEqual(withSession.body.context, { sessionId: 'root-agent', cwd: 'E:/proj/one' })
    assert.equal(withSession.body.runs[0].runId, plan.runId)
    assert.equal(withSession.body.runs[0].sessionId, 'root-agent')
    assert.equal(withSession.body.runs[0].cwd, process.cwd())

    // 会话服务取不到（CLI/脚本里跑）时不能抛，只回 cwd:null，让前端退回「全部」。
    const withoutSession = await call(`${prefix}/api/state`)
    assert.deepEqual(withoutSession.body.context, { sessionId: null, cwd: null })
  } finally {
    cleanup()
  }
})

test('空证据的 verify 被拒（空证据不算检查）', async () => {
  const graph = {
    task: '需求',
    brief: '目标与验收标准',
    nodes: [
      { id: 'n1', type: 'step', goal: '干活' },
      { id: 'c1', type: 'check', goal: '判定' },
    ],
    edges: [{ from: 'n1', to: 'c1' }],
  }
  const { dir, cleanup, tools, plan } = await runFixture(graph)
  try {
    await tools.get('orch_dispatch').execute({ runId: plan.runId, nodeId: 'n1', subagentPrompt: '做 n1' }, exec)
    await assert.rejects(
      () => tools.get('orch_verify').execute({ runId: plan.runId, nodeId: 'c1', verdict: 'pass', evidence: [] }, exec),
      /证据/,
    )
  } finally {
    cleanup()
  }
})
