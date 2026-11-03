/**
 * dsh-orchestrator-canvas — host side.
 *
 * 图即真相：一次编排 = 一份 run.json + 一份 events.jsonl。状态只能经这 5 个工具写入，
 * 客户端画布只读。五段流：Brief（orch_plan）→ Decompose（orch_plan 校验 DAG）→
 * Dispatch（orch_dispatch）→ Verify（orch_verify 证据闸门）→ Accept（orch_accept 用户确认）。
 *
 * 设计约束（见 README）：
 * - 不自写调度引擎：子代理派发一律走 ctx.subagents，本插件只做闸门与状态机。
 * - 不拖拽改图：v0 画布是投影，节点位置由依赖深度计算，不接受手工编辑。
 */

import os from 'node:os'
import path from 'node:path'

import { OrchGraphError, downstreamOf, depthLayers, validateGraph } from './graph.js'
import { listRuns, newRunId, pruneRuns, readRun, runDir, writeRun } from './store.js'

export const name = 'dsh-orchestrator-canvas'

/** tools 是硬依赖；subagents / webServer / systemPrompt / userQuestions 用 ctx.get 可选接入。 */
export const inject = ['tools']

export const defaults = {
  /** run 根目录；空则按 DSH_HOME 推导。 */
  runsDir: '',
  /** 同一 run 里允许同时 running 的 step 数。 */
  maxParallel: 3,
  /** 子代理 provider 名，缺省 spawn；不存在时退回注册表里第一个。 */
  subagentProvider: 'spawn',
  /** 子代理统一工作目录；空则继承当前进程 cwd。 */
  subagentCwd: '',
  retentionDays: 30,
  retentionBytes: 200 * 1024 * 1024,
  autoPrune: true,
  /** 单次 tool 返回里子代理原始输出的截断长度。 */
  outputLimit: 12000,
}

/** 只读 HTTP 接口的挂载前缀（宿主给插件路由的既命名空间）。 */
const ORCH_ROUTE_PREFIX = '/_dsh/orchestrator-canvas'

const NODE_TYPES = ['step', 'check', 'merge']
const EVIDENCE_KINDS = ['command', 'test', 'artifact', 'review']
const TERMINAL = new Set(['done', 'failed', 'blocked'])

// ---------------------------------------------------------------- 小工具

function nowIso() {
  return new Date().toISOString()
}

function textOf(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

function cut(text, limit) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  if (s.length <= limit) return s
  return `${s.slice(0, limit)}\n…（已截断，原始 ${s.length} 字；完整内容在 run.json 的节点 attempts 里）`
}

function defaultRunsDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'orchestrator', 'runs')
}

function fail(message, info) {
  const error = new Error(message)
  if (info) error.info = info
  return error
}

/** 期望失败的执行：抛带中文说明的错误，让模型看到"为什么被拒"。 */
function reject(message) {
  throw fail(message)
}

// ---------------------------------------------------------------- 图遍历

function nodeIndex(run) {
  const map = new Map()
  for (const n of run.nodes) map.set(n.id, n)
  return map
}

function parentsOf(run, nodeId) {
  return run.edges.filter((e) => e.to === nodeId).map((e) => e.from)
}

function childrenOf(run, nodeId) {
  return run.edges.filter((e) => e.from === nodeId).map((e) => e.to)
}

function getNode(run, nodeId) {
  const node = nodeIndex(run).get(nodeId)
  if (!node) reject(`run ${run.runId} 里没有节点 "${nodeId}"。可用节点：${run.nodes.map((n) => n.id).join(', ')}`)
  return node
}

/** 所有 merge 节点在父节点全 done 时自动 done；被失败阻塞的节点在上游恢复后回到 pending。
 *  返回自动发生的状态迁移事件（merge 汇合必须落 events.jsonl，否则审计日志里汇合这一步不可见）。 */
function settle(run) {
  const events = []
  let changed = true
  while (changed) {
    changed = false
    for (const node of run.nodes) {
      if (node.type === 'merge' && node.status === 'pending') {
        const parents = parentsOf(run, node.id)
        if (parents.length > 0 && parents.every((p) => nodeIndex(run).get(p)?.status === 'done')) {
          node.status = 'done'
          node.startedAt = node.startedAt ?? nowIso()
          node.endedAt = nowIso()
          events.push({ kind: 'merge', nodeId: node.id, detail: { parents } })
          changed = true
        }
      }
      if (node.status === 'blocked') {
        const parents = parentsOf(run, node.id)
        if (parents.length > 0 && parents.every((p) => !['failed', 'blocked'].includes(nodeIndex(run).get(p)?.status ?? 'pending'))) {
          node.status = 'pending'
          node.blockedReason = null
          changed = true
        }
      }
    }
  }

  return events
}

/** 把 from 的全部下游（未终态）标 blocked。 */
function blockDownstream(run, fromId, reason) {
  const down = downstreamOf(fromId, run.edges)
  const blocked = []
  for (const id of down) {
    const node = nodeIndex(run).get(id)
    if (!node) continue
    if (node.status === 'pending' || node.status === 'running') {
      node.status = 'blocked'
      node.blockedReason = reason
      blocked.push(id)
    }
  }
  return blocked
}

/** 重跑某 step 时，把挂在它下面的 check 重新待命。 */
function rearmChecks(run, stepId) {
  const rearmed = []
  for (const edge of run.edges) {
    if (edge.from !== stepId) continue
    const node = nodeIndex(run).get(edge.to)
    if (node && node.type === 'check' && node.status !== 'pending') {
      node.status = 'pending'
      rearmed.push(node.id)
    }
  }
  return rearmed
}

function runningCount(run) {
  return run.nodes.filter((n) => n.status === 'running').length
}

function dispatchable(run) {
  const index = nodeIndex(run)
  return run.nodes
    .filter((n) => n.type === 'step' && n.status === 'pending')
    .filter((n) => parentsOf(run, n.id).every((p) => index.get(p)?.status === 'done'))
    .map((n) => n.id)
}

/** 验收前置检查：返回还缺什么。 */
function acceptanceGaps(run) {
  const gaps = []
  for (const node of run.nodes) {
    if (node.status === 'running') gaps.push(`${node.id}（${node.type}）还在跑`)
    if (node.status === 'pending') gaps.push(`${node.id}（${node.type}）还没开始`)
    if (node.status === 'failed') gaps.push(`${node.id}（${node.type}）失败了，需要重跑`)
    if (node.status === 'blocked') gaps.push(`${node.id}（${node.type}）被上游失败阻塞`)
    if (node.type === 'check' && node.status === 'done' && (node.evidence?.length ?? 0) === 0) {
      gaps.push(`${node.id}（check）pass 了但没有证据——空证据不算检查`)
    }
  }
  return gaps
}

// ---------------------------------------------------------------- 序列化

function briefRun(run) {
  return {
    runId: run.runId,
    task: run.task,
    brief: run.brief,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    layers: run.layers,
    dispatchable: dispatchable(run),
    gaps: acceptanceGaps(run),
    counts: countNodes(run),
    nodes: run.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      goal: n.goal,
      status: n.status,
      verdict: n.verdict ?? null,
      evidence: n.evidence?.length ?? 0,
      attempts: n.attempts?.length ?? 0,
      childId: n.attempts?.[n.attempts.length - 1]?.childId ?? null,
      startedAt: n.startedAt ?? null,
      endedAt: n.endedAt ?? null,
      blockedReason: n.blockedReason ?? null,
      lastError: n.lastError ?? null,
    })),
    edges: run.edges,
  }
}

function countNodes(run) {
  const counts = { step: 0, check: 0, merge: 0 }
  for (const n of run.nodes) if (n.type in counts) counts[n.type] += 1
  return counts
}

function textBlock(text) {
  return { type: 'text', text }
}

function outputSchema() {
  return { type: 'object', additionalProperties: true }
}

function makeOutput(render) {
  return { schema: outputSchema(), render: (args, value) => [textBlock(render(args, value))] }
}

// ---------------------------------------------------------------- 插件

/**
 * @param {import('cordis').Context} ctx
 * @param {Partial<typeof defaults>} [raw]
 */
export function apply(ctx, raw) {
  const config = { ...defaults, ...(raw ?? {}) }
  const runsDir = config.runsDir ? config.runsDir : defaultRunsDir()

  const subagents = () => ctx.get('subagents')
  const userQuestions = () => ctx.get('userQuestions')

  /** 同 run 读改写串行，避免并行 dispatch 互相覆盖。 */
  const runLocks = new Map()
  function withRunLock(runId, fn) {
    const prev = runLocks.get(runId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    runLocks.set(
      runId,
      next.then(
        () => {},
        () => {},
      ),
    )
    return next
  }

  async function load(runId) {
    if (!runId) reject('缺少 runId。先用 orch_plan 建图，或 orch_state 查现有 run。')
    try {
      return await readRun(runsDir, runId)
    } catch (error) {
      if (error?.code === 'ENOENT') reject(`run "${runId}" 不存在（目录 ${runDir(runsDir, runId)}）。用 orch_state 看现有 run 列表。`)
      throw error
    }
  }

  async function save(run, event) {
    run.updatedAt = nowIso()
    for (const item of Array.isArray(event) ? event : [event]) {
      if (item) await writeRun(runsDir, run, item)
    }
    return run
  }

  // ------------------------------------------------------------ orch_plan

  const orchPlan = {
    name: 'orch_plan',
    description:
      '工作画布流第一步：把任务拆成有依赖关系的图并落盘（必须调用）。什么时候必须调用：用户交来的任务满足任一条——①能拆成 2 个以上可分开的步骤；②其中若干步可以并行；③要求证据/验收/重试，不能只凭一句"我做完了"交差。调用前先想清楚 DAG：每个 step 后面必须至少挂一个 check（check 的 evidence 是后续 orch_verify 的硬门槛），只有需要多父汇合时才用 merge。单步、一问就能答完的任务不要调用本工具。下一次要调用的工具是 orch_dispatch（已可派发的节点见返回的 order/dispatchable）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['task', 'brief', 'nodes', 'edges'],
      properties: {
        task: { type: 'string', description: '用户原话（原样保留，不改写）。' },
        brief: {
          type: 'string',
          description: '你把用户原话改写成的目标 + 验收标准。只能等义改写，不得扩大范围；它会被存进 run.json.brief 供画布展示。',
        },
        nodes: {
          type: 'array',
          minItems: 2,
          description: '节点：step=要干的活，check=对某个 step 的判定，merge=多父汇合（可省略）。',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'goal'],
            properties: {
              id: { type: 'string', description: '短 id，如 n1 / t2 / check-1，全图唯一。' },
              type: { type: 'string', enum: NODE_TYPES },
              goal: { type: 'string', description: '这一步要产出什么（一句话，画布上就是这张卡片）。' },
              detail: { type: 'string', description: '可选：补充约束、验收口径、参考文件。' },
            },
          },
        },
        edges: {
          type: 'array',
          description: '依赖边 from → to（to 依赖 from）。check 必须恰好有一个 step 父节点。',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
            },
          },
        },
      },
    },
    output: makeOutput((args, value) => {
      if (!value || typeof value !== 'object') return '编排图已落盘。'
      return [
        `已建 run ${value.runId}：${value.counts.step} 个 step / ${value.counts.check} 个 check / ${value.counts.merge} 个 merge。`,
        `拓扑序：${value.order.join(' → ')}`,
        `分层（同一行可并行）：${value.layers.map((row, i) => `${i}:${row.join('+')}`).join(' | ')}`,
        `现在可派发：${value.dispatchable.length ? value.dispatchable.join(', ') : '无（先看依赖）'}`,
        `归属：${value.sessionId ? `会话 ${value.sessionId}` : '未知会话'} · ${value.cwd ?? '未知目录'}`,
        `run 目录：${value.runsDir}`,
      ].join('\n')
    }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const task = String(args?.task ?? '').trim()
      const brief = String(args?.brief ?? '').trim()
      const nodes = Array.isArray(args?.nodes) ? args.nodes : []
      const edges = Array.isArray(args?.edges) ? args.edges : []
      if (!task) reject('task 不能为空：把用户原话放进去。')
      if (!brief) reject('brief 不能为空：先改写目标与验收标准，不能直接抄 task 了事。')

      let graph
      try {
        graph = validateGraph(nodes, edges)
      } catch (error) {
        if (error instanceof OrchGraphError) {
          reject(`图不合法（${error.code}）：${error.message}${error.details ? `；详情：${JSON.stringify(error.details)}` : ''}`)
        }
        throw error
      }

      const runId = newRunId()
      const createdAt = nowIso()
      // 归属信息：画布默认只看「本会话」，所以 run 必须记住是谁、在哪个目录下发的。
      // 两个字段都可能在非 Agent 上下文里缺失（比如脚本直调），缺失就写 null，不做假值。
      const sessionId = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : null
      const cwd = exec && typeof exec.cwd === 'string' && exec.cwd ? exec.cwd : null
      const run = {
        version: 1,
        runId,
        task,
        brief,
        sessionId,
        cwd,
        status: 'active',
        createdAt,
        updatedAt: createdAt,
        maxParallel: config.maxParallel,
        layers: graph.layers,
        order: graph.order,
        edges,
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          goal: n.goal,
          detail: n.detail ?? '',
          status: 'pending',
          attempts: [],
          evidence: [],
          verdict: null,
          startedAt: null,
          endedAt: null,
          blockedReason: null,
          lastError: null,
        })),
        acceptance: { acceptedAt: null, summary: null },
      }
      const autoEvents = settle(run)
      await save(run, [{ kind: 'plan', detail: { nodes: run.nodes.length, edges: edges.length } }, ...autoEvents])
      return {
        runId,
        order: graph.order,
        layers: graph.layers,
        counts: countNodes(run),
        dispatchable: dispatchable(run),
        sessionId,
        cwd,
        runsDir: runDir(runsDir, runId),
      }
    },
  }

  // ------------------------------------------------------------ orch_dispatch

  const orchDispatch = {
    name: 'orch_dispatch',
    description:
      '把一个 step 节点派给子代理执行（必须调用，不要自己在本轮里替子代理干活）。什么时候必须调用：orch_plan 返回后，每个已满足依赖的 step 都走本工具；同一轮可以并行调用多个不同 nodeId 的本工具（上限见 maxParallel，超了会被拒）。它返回子代理的最终输出摘要，你据此调用 orch_verify 给挂在该 step 下的 check 下判定。依赖没完成、节点是 check/merge、并行度已满时会被拒绝并说明原因。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'nodeId', 'subagentPrompt'],
      properties: {
        runId: { type: 'string' },
        nodeId: { type: 'string', description: 'orch_plan 里定义的 step 节点 id。' },
        subagentPrompt: {
          type: 'string',
          description: '给子代理的完整任务书：目标、边界（不许改哪些文件）、验收口径、要交回什么证据。子代理看不到当前会话，必须自包含。',
        },
        inputs: {
          type: 'string',
          description: '可选：上游节点的产出摘要，会拼进任务书。',
        },
      },
    },
    output: makeOutput((args, value) => {
      if (!value || typeof value !== 'object') return '派发结束。'
      return [
        `节点 ${value.nodeId}：${value.status}${value.stopReason ? `（${value.stopReason}）` : ''}`,
        value.childId ? `子代理会话：${value.childId}` : '',
        value.output ? `\n子代理输出：\n${value.output}` : '',
        value.next ?? '',
      ]
        .filter(Boolean)
        .join('\n')
    }),
    isConcurrencySafe: (args) => Boolean(args && typeof args === 'object'),
    async execute(args, exec) {
      const { runId, nodeId, subagentPrompt, inputs } = args ?? {}
      if (!subagentPrompt || !String(subagentPrompt).trim()) reject('subagentPrompt 不能为空：子代理看不到本会话，任务书必须自包含。')

      const pre = await withRunLock(runId, async () => {
        const run = await load(runId)
        if (run.status === 'accepted') reject(`run ${runId} 已验收，不能再派发。新任务请重新 orch_plan。`)
        const node = getNode(run, nodeId)
        if (node.type !== 'step') reject(`节点 ${nodeId} 是 ${node.type}，只有 step 能派发。check 用 orch_verify，merge 会自动汇合。`)
        const parents = parentsOf(run, nodeId)
        const waiting = parents.filter((p) => nodeIndex(run).get(p)?.status !== 'done')
        if (waiting.length) reject(`节点 ${nodeId} 的依赖还没完成：${waiting.join(', ')}。先把它们做完（done）再派发本节点。`)
        if (runningCount(run) >= (run.maxParallel ?? config.maxParallel)) {
          reject(`并行度已满：当前 ${runningCount(run)} 个节点在跑，上限 ${run.maxParallel ?? config.maxParallel}。等一个跑完再派。`)
        }
        if (node.status === 'running') reject(`节点 ${nodeId} 已经在跑了，别重复派。`)

        const attempt = (node.attempts?.length ?? 0) + 1
        node.status = 'running'
        node.startedAt = nowIso()
        node.endedAt = null
        node.lastError = null
        node.blockedReason = null
        node.attempts = node.attempts ?? []
        node.attempts.push({ attempt, at: node.startedAt, prompt: String(subagentPrompt), childId: null, stopReason: null, output: '', error: null })
        const rearmed = rearmChecks(run, nodeId)
        const autoEvents = settle(run)
        await save(run, [{ kind: 'dispatch', nodeId, detail: { attempt, rearmed } }, ...autoEvents])
        return { attempt, cwd: config.subagentCwd || exec.cwd || process.cwd() }
      })

      const service = subagents()
      if (!service) reject('当前 composition 没有 subagents 服务，无法派子代理；请让用户在能派子代理的 profile 里跑编排。')
      const providers = service.list?.() ?? []
      const provider = providers.includes(config.subagentProvider) ? config.subagentProvider : providers[0]
      if (!provider) reject('没有已注册的子代理 provider（subagents.list() 为空），无法派发。')
      if (!exec.agent) reject('当前工具调用没有关联 agent，无法把子代理挂到你名下。')

      const prompt = [
        String(subagentPrompt).trim(),
        inputs && String(inputs).trim() ? `\n\n## 上游产出（供参考，不要照抄）\n${String(inputs).trim()}` : '',
        `\n\n## 回报要求\n做完后直接给结论：改了哪些文件、跑了哪些命令、结果如何、以及任何没做完/有风险的地方。不要复述过程。`,
      ]
        .filter(Boolean)
        .join('')

      let result
      let childId = null
      try {
        const activation = await service.startActivation({
          provider,
          label: `orch ${runId}/${nodeId} #${pre.attempt}`,
          request: {
            cwd: pre.cwd,
            prompt: [{ type: 'text', text: prompt }],
            parent: exec.agent,
            signal: exec.signal,
          },
          signal: exec.signal,
          delivery: 'parent',
        })
        childId = activation.childId ?? null
        result = await activation.result
      } catch (error) {
        const message = error?.message ?? String(error)
        return withRunLock(runId, async () => {
          const run = await load(runId)
          const node = getNode(run, nodeId)
          node.status = 'failed'
          node.endedAt = nowIso()
          node.lastError = message
          const last = node.attempts[node.attempts.length - 1]
          if (last) {
            last.endedAt = nowIso()
            last.error = message
            last.stopReason = 'error'
          }
          const blocked = blockDownstream(run, nodeId, `上游 ${nodeId} 派发失败：${message}`)
          const autoEvents = settle(run)
          await save(run, [{ kind: 'dispatch-error', nodeId, detail: { message, blocked } }, ...autoEvents])
          return { nodeId, status: node.status, childId, stopReason: 'error', output: message, blocked, next: `节点 ${nodeId} 派发失败，下游已标 blocked：${blocked.join(', ') || '无'}。修好原因后用 orch_dispatch 重试该节点（会记为新 attempt），或用 orch_verify 记录失败证据。` }
        })
      }

      const text = cut(textOf(result?.output), config.outputLimit)
      const stopReason = result?.stopReason ?? 'completed'
      const ok = stopReason === 'completed'

      return withRunLock(runId, async () => {
        const run = await load(runId)
        const node = getNode(run, nodeId)
        node.endedAt = nowIso()
        const last = node.attempts[node.attempts.length - 1]
        if (last) {
          last.childId = childId
          last.endedAt = node.endedAt
          last.stopReason = stopReason
          last.output = text
          if (result?.structured !== undefined) last.structured = result.structured
        }
        if (ok) {
          node.status = 'done'
          node.verdict = null
        } else {
          node.status = 'failed'
          node.lastError = `子代理未正常完成：${stopReason}${result?.diagnostic ? `（${result.diagnostic}）` : ''}`
          blockDownstream(run, nodeId, `上游 ${nodeId} 未完成（${stopReason}）`)
        }
        const autoEvents = settle(run)
        const checks = childrenOf(run, nodeId)
          .map((id) => nodeIndex(run).get(id))
          .filter((n) => n && n.type === 'check')
          .map((n) => n.id)
        await save(run, [
          { kind: ok ? 'dispatch-done' : 'dispatch-fail', nodeId, detail: { childId, stopReason } },
          ...autoEvents,
        ])
        return {
          nodeId,
          status: node.status,
          childId,
          stopReason,
          output: text,
          checks,
          blocked: ok ? [] : [...downstreamOf(nodeId, run.edges)],
          next: ok
            ? `现在用 orch_verify 给 check 下判定：${checks.join(', ')}（evidence 不能为空）。`
            : `该步失败，下游已标 blocked。修正后重新 orch_dispatch 同一个 nodeId（attempt ${last?.attempt ?? 1} → ${(last?.attempt ?? 1) + 1}）。`,
        }
      })
    },
  }

  // ------------------------------------------------------------ orch_verify

  const orchVerify = {
    name: 'orch_verify',
    description:
      '给 check 节点下判定并写证据（必须调用，空证据会被拒）。什么时候必须调用：某个 step 跑完后、accept 之前，对挂在它下面的每个 check 各调一次；evidence 里放真实跑过的命令与关键输出、或跑过的测试、或产出的文件路径、或你逐条核对过的评审结论。verdict:"fail" 会把该 check 与它的父 step 标失败、把下游标 blocked，并返回重试补丁（重跑的 prompt 追加项）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'nodeId', 'verdict', 'evidence'],
      properties: {
        runId: { type: 'string' },
        nodeId: { type: 'string', description: 'check 节点 id（不是 step）。' },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        evidence: {
          type: 'array',
          minItems: 1,
          description: '至少一条。kind=command 放命令行与关键输出；test 放测试名与 pass/fail 数；artifact 放产物路径；review 放逐条核对结论。',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'value'],
            properties: {
              kind: { type: 'string', enum: EVIDENCE_KINDS },
              value: { type: 'string', description: '证据正文，必须能被别人复核（命令、输出、路径、结论）。' },
              author: { type: 'string', description: '谁给的证据，默认 model。' },
            },
          },
        },
        note: { type: 'string', description: '可选：判定理由，尤其 fail 时要写清楚差在哪。' },
      },
    },
    output: makeOutput((args, value) => {
      if (!value || typeof value !== 'object') return '判定已记录。'
      const head = `check ${value.nodeId}：${value.verdict}（证据 ${value.evidenceCount} 条）`
      if (value.verdict === 'pass') return `${head}\n${value.next ?? ''}`
      return [
        head,
        `父 step ${value.parentStepId} 已标 failed，下游 blocked：${(value.blocked ?? []).join(', ') || '无'}`,
        value.retryPrompt ? `重试时给子代理追加的要求：\n${value.retryPrompt}` : '',
        value.next ?? '',
      ]
        .filter(Boolean)
        .join('\n')
    }),
    isConcurrencySafe: () => false,
    async execute(args) {
      const { runId, nodeId, verdict, evidence, note } = args ?? {}
      if (!['pass', 'fail'].includes(verdict)) reject('verdict 只能是 "pass" 或 "fail"。')
      const list = Array.isArray(evidence) ? evidence : []
      if (list.length === 0) reject('evidence 不能为空：空证据等于没有检查。把命令/输出/测试/产物路径/评审结论至少写一条。')
      for (const item of list) {
        if (!item || !EVIDENCE_KINDS.includes(item.kind)) reject(`证据 kind 只能是 ${EVIDENCE_KINDS.join(' / ')}，收到 ${JSON.stringify(item?.kind)}。`)
        if (!item.value || !String(item.value).trim()) reject(`证据 ${item.kind} 的 value 不能为空。`)
      }

      return withRunLock(runId, async () => {
        const run = await load(runId)
        if (run.status === 'accepted') reject(`run ${runId} 已验收，不能再改判定。`)
        const node = getNode(run, nodeId)
        if (node.type !== 'check') reject(`节点 ${nodeId} 是 ${node.type}，只有 check 用 orch_verify（step 用 orch_dispatch）。`)
        const parents = parentsOf(run, nodeId)
        if (parents.length !== 1) reject(`check ${nodeId} 的父节点数量异常：${parents.length}。`)
        const stepId = parents[0]
        const step = getNode(run, stepId)
        if (step.status !== 'done') {
          reject(`父 step ${stepId} 还没 done（当前 ${step.status}）。先 orch_dispatch 它，跑完再判定这个 check。`)
        }

        const at = nowIso()
        node.evidence = node.evidence ?? []
        node.evidence.push(...list.map((item) => ({ kind: item.kind, value: String(item.value), author: item.author ?? 'model', at })))
        node.verdict = verdict
        node.endedAt = at
        node.note = note ?? ''
        let blocked = []
        let retryPrompt = ''
        if (verdict === 'pass') {
          node.status = 'done'
        } else {
          node.status = 'failed'
          step.status = 'failed'
          step.lastError = `check ${nodeId} 判定 fail${note ? `：${note}` : ''}`
          step.endedAt = step.endedAt ?? at
          blocked = blockDownstream(run, stepId, `上游 ${stepId} 的 check ${nodeId} 判定 fail`)
          retryPrompt = [
            `上一轮 ${stepId} 的产出没通过 ${nodeId} 的检查。`,
            note ? `失败原因：${note}` : `失败证据：${list.map((i) => `[${i.kind}] ${i.value}`).join('；')}`,
            `这一轮必须补上：①针对上述失败点重修；②交回可复核的证据（命令+输出 / 测试结果 / 产物路径）；③如果发现是上一轮的任务书本身有问题，先说明再改。`,
          ].join('\n')
        }
        const autoEvents = settle(run)
        await save(run, [{ kind: 'verify', nodeId, detail: { verdict, evidenceCount: list.length, blocked } }, ...autoEvents])
        const gaps = acceptanceGaps(run)
        return {
          nodeId,
          verdict,
          evidenceCount: node.evidence.length,
          parentStepId: stepId,
          status: node.status,
          blocked,
          retryPrompt,
          gaps,
          next:
            verdict === 'pass'
              ? gaps.length
                ? `check 通过。还差：${gaps.join('；')}`
                : '所有闸门已通过，可以 orch_accept 交付了（会向用户确认）。'
              : `用 orch_dispatch 重跑 ${stepId}（把上面重试要求写进 subagentPrompt），跑完重新 orch_verify 这个 check。`,
        }
      })
    },
  }

  // ------------------------------------------------------------ orch_accept

  const orchAccept = {
    name: 'orch_accept',
    description:
      '交付验收（必须调用，不要口头宣布完成）。什么时候必须调用：所有 step/merge 都 done、所有 check 都 pass 且带证据之后，且你已经能给出"交付物→节点→证据"摘要。前置不满足会拒绝并列出缺什么；满足后本工具会向用户弹出确认卡片，用户点确认才算 accepted 并写进 run.json.acceptance。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'summary'],
      properties: {
        runId: { type: 'string' },
        summary: {
          type: 'string',
          description: '给用户看的交付摘要：交付了什么（文件/命令/结论）、每条对应哪个节点、证据是什么。',
        },
      },
    },
    output: makeOutput((args, value) => {
      if (!value || typeof value !== 'object') return '验收处理完成。'
      if (value.ok) return `run ${value.runId} 已验收。\n\n${value.digest ?? ''}`
      return [`验收被拒：还缺 ${value.missing.length} 项`, ...value.missing.map((g) => `- ${g}`), value.next ?? ''].filter(Boolean).join('\n')
    }),
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { runId, summary } = args ?? {}
      if (!summary || !String(summary).trim()) reject('summary 不能为空：交付必须说清"交付物→节点→证据"。')

      const run = await load(runId)
      const gaps = acceptanceGaps(run)
      if (gaps.length) {
        await save(run, { kind: 'accept-rejected', detail: { missing: gaps } })
        return { ok: false, runId, missing: gaps, next: '把这些缺口补完再调本工具：pending 的派发、failed 的重跑、blocked 的先修上游、check 的补 evidence。' }
      }

      const digest = run.nodes
        .map((n) => `- ${n.id}（${n.type}）${n.goal}：${n.status}${n.evidence?.length ? ` · 证据 ${n.evidence.length} 条` : ''}`)
        .join('\n')

      // 用户显式确认：有 userQuestions 就弹卡片，没有就只做预检、不落 accepted。
      const questions = userQuestions()
      if (!questions?.ask) {
        const missing = ['当前 composition 没有 userQuestions 服务，无法向用户确认；已通过全部闸门但不会自动 accepted。']
        await save(run, { kind: 'accept-rejected', detail: { missing } })
        return {
          ok: false,
          runId,
          missing,
          next: '让用户口头确认后，在一个带 userQuestions 的会话里重试 orch_accept。',
          digest,
        }
      }

      const answer = await questions.ask({
        questions: [
          {
            id: 'accept',
            header: '编排验收',
            question: `编排任务「${run.task.slice(0, 120)}」已通过全部闸门（${countNodes(run).step} step / ${countNodes(run).check} check）。确认交付？`,
            detail: summary,
            options: [
              { label: '确认交付', description: '写入 accepted，run 关闭。' },
              { label: '还要改', description: '不关闭，告诉我改哪，你继续编排。' },
            ],
          },
        ],
        agent: exec.agent,
        signal: exec.signal,
        wait: { callId: exec.callId },
      })
      const picked = answer?.answers?.find((a) => a.id === 'accept')
      const confirmed = (picked?.selected ?? []).includes('确认交付')
      if (!confirmed) {
        const missing = [`用户没有确认交付${picked?.custom ? `（补充：${picked.custom}）` : '（选了"还要改"）'}`]
        await save(run, { kind: 'accept-rejected', detail: { missing } })
        return {
          ok: false,
          runId,
          missing,
          next: '按用户意见继续：用 orch_dispatch 重跑相关节点，再 orch_verify。',
          digest,
        }
      }

      return withRunLock(runId, async () => {
        const fresh = await load(runId)
        fresh.status = 'accepted'
        fresh.acceptance = { acceptedAt: nowIso(), summary: String(summary), digest }
        await save(fresh, { kind: 'accept', detail: { summary } })
        await pruneQuietly()
        return { ok: true, runId, digest, next: '已验收。历史 run 仍可 orch_state 或画布查看。' }
      })
    },
  }

  // ------------------------------------------------------------ orch_state

  const orchState = {
    name: 'orch_state',
    description:
      '读编排状态（必须调用，不要凭记忆猜进度）。什么时候必须调用：接着上一轮的 run 继续干活前、用户问进度/卡在哪/为什么没交付时、或者你不确定下一步该派发哪个节点时。不带 runId 返回最近 run 列表 + 最新活跃 run 的节点状态；带 runId 返回单个 run 的完整状态与"还缺什么"。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        runId: { type: 'string', description: '可选；不给则看最近的 run。' },
      },
    },
    output: makeOutput((args, value) => {
      if (!value || typeof value !== 'object') return '无编排状态。'
      if (value.runs && !value.run) {
        if (!value.runs.length) return '还没有任何编排 run。需要多步任务时先调 orch_plan。'
        return ['最近的编排 run：', ...value.runs.map((r) => `- ${r.runId} [${r.status}] ${String(r.task ?? '').slice(0, 60)}（${r.nodeCount} 节点，更新 ${r.updatedAt}）`)].join('\n')
      }
      const run = value.run
      const head = `run ${run.runId} [${run.status}] ${String(run.task ?? '').slice(0, 80)}`
      const nodes = run.nodes
        .map((n) => `- ${n.id} (${n.type}) ${n.status}${n.verdict ? `/${n.verdict}` : ''}${n.evidence ? ` · 证据 ${n.evidence}` : ''}${n.blockedReason ? ` · ${n.blockedReason}` : ''}`)
        .join('\n')
      return [head, `可派发：${run.dispatchable.join(', ') || '无'}`, nodes, run.gaps.length ? `还缺：${run.gaps.join('；')}` : '闸门全过，可以 accept。'].join('\n')
    }),
    isConcurrencySafe: () => true,
    async execute(args) {
      const runId = args?.runId
      if (runId) {
        const run = await load(runId)
        return { run: briefRun(run) }
      }
      let runs = []
      try {
        runs = await listRuns(runsDir)
      } catch {
        runs = []
      }
      if (!runs.length) return { runs: [], run: null }
      const active = runs.find((r) => r.status === 'active')
      const pick = active ?? runs[0]
      let run = null
      try {
        run = briefRun(await readRun(runsDir, pick.runId))
      } catch {
        run = null
      }
      return { runs: runs.slice(0, 10), run }
    },
  }

  // ------------------------------------------------------------ 注册

  const TOOLS = [orchPlan, orchDispatch, orchVerify, orchAccept, orchState]
  for (const definition of TOOLS) {
    ctx.effect(() => ctx.tools.register(definition), `orchestrator-canvas: tool ${definition.name}`)
  }

  // 系统提示：模型不知道这些工具的存在就不会用。只在 systemPrompt 可用时挂。
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt?.section) {
    const text = [
      '## 工作画布流（orchestrator canvas，宿主工具）',
      '',
      '需要多步、可并行、要证据验收的任务，走这条流水线，不要自己一口气写完：',
      '1. `orch_plan`：把任务拆成 DAG（step / check / merge），每个 step 后面必须挂 check。',
      '2. `orch_dispatch`：把已满足依赖的 step 派给子代理（并行度有上限，超了会被拒）。',
      '3. `orch_verify`：给 check 写真实证据并下 pass/fail；fail 会把下游标 blocked 并给你重试补丁。',
      '4. `orch_accept`：闸门全过后向用户确认交付，不要口头宣布完成。',
      '5. `orch_state`：不确定进度或接着上一轮干之前，先读状态。',
      '',
      '图即真相：节点状态只能经这些工具写入，画布只是投影。单步/一问就能答完的任务不要走这条流。',
    ].join('\n')
    ctx.effect(
      () => systemPrompt.section({ name: 'orchestrator-canvas:flow', order: 5000, text }),
      'orchestrator-canvas: system prompt',
    )
  }

  // 只读 HTTP 接口给画布用。
  // webServer 走可选的 ctx.inject 子作用域：它是浏览器载体服务，插件被热插到
  // profile 根作用域时 ctx.get('webServer') 可能取不到，而 inject 会在服务就绪后回调。
  // 路径放在 /_dsh/orchestrator-canvas/ 下：这是宿主给插件路由的既有命名空间
  // （dsh-vision-router 用 /_dsh/vision-router/…），不会和 SPA 路由抢路径。
  ctx.inject(['webServer'], (webCtx) => {
    const handler = async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith(ORCH_ROUTE_PREFIX)) {
          res.statusCode = 404
          res.end('not found')
          return
        }
        // 画布只读：写状态只能经 orch_* 工具，HTTP 一律只放 GET/HEAD。
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405
          res.setHeader('allow', 'GET, HEAD')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }
        const send = (value, code = 200) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(value))
        }
        const tail = url.pathname.slice(ORCH_ROUTE_PREFIX.length) || '/'
        if (tail === '/api/health') return send({ ok: true, runsDir })
        if (tail === '/api/state') {
          const wantId = url.searchParams.get('runId')
          // 画布默认只看「本会话」：客户端把 slot 给的 sessionId 带上来，
          // 宿主用现场会话的 header.cwd 反查工作区（Session 只在持有期间是 live 的，
          // 取不到就返回 null，客户端会退回「全部」并提示）。
          const wantSession = url.searchParams.get('session')
          let context = { sessionId: wantSession || null, cwd: null }
          if (wantSession) {
            try {
              const sessions = ctx.get('sessions')
              const live = sessions && typeof sessions.get === 'function' ? sessions.get(wantSession) : null
              const liveCwd = live && live.header && live.header.cwd ? String(live.header.cwd) : null
              if (liveCwd) context = { sessionId: wantSession, cwd: liveCwd }
            } catch {
              /* 会话服务不可用：保持 cwd=null */
            }
          }
          let runs = []
          try {
            runs = await listRuns(runsDir)
          } catch {
            runs = []
          }
          let run = null
          try {
            if (wantId) run = briefRun(await readRun(runsDir, wantId))
            else {
              const pick = runs.find((r) => r.status === 'active') ?? runs[0]
              if (pick) run = briefRun(await readRun(runsDir, pick.runId))
            }
          } catch {
            run = null
          }
          return send({ ok: true, runs: runs.slice(0, 50), run, context, at: nowIso() })
        }
        if (tail === '/api/run') {
          const wantId = url.searchParams.get('runId')
          if (!wantId) return send({ ok: false, error: 'runId required' }, 400)
          const run = await load(wantId)
          return send({ ok: true, run })
        }
        return send({ ok: false, error: 'unknown endpoint' }, 404)
      } catch (error) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: error?.message ?? String(error) }))
      }
    }
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ORCH_ROUTE_PREFIX, handler }),
      'orchestrator-canvas: http route',
    )
  })

  async function pruneQuietly() {
    if (config.autoPrune === false) return
    try {
      await pruneRuns(runsDir, { days: config.retentionDays, maxBytes: config.retentionBytes })
    } catch {
      /* 清理失败不影响主流程 */
    }
  }
  if (config.autoPrune !== false) void pruneQuietly()

  return { runsDir }
}
