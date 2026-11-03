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
