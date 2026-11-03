// 工作画布图的纯逻辑层：校验、拓扑排序、分层、可达性、check 覆盖映射。
// 本模块不依赖任何外部包，只使用语言内置能力，方便宿主与测试直接复用。

/** 合法节点类型 */
const NODE_TYPES = new Set(['step', 'check', 'merge']);

/**
 * 图校验错误。用 code 区分类别，details 带违规元素，message 给人看。
 * code 取值：EMPTY_GRAPH | NODE_DUP | NODE_TYPE | EDGE_UNKNOWN | EDGE_SELF |
 *           CHECK_PARENT | CYCLE | CHECK_COVERAGE
 */
export class OrchGraphError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OrchGraphError';
    this.code = code;
    this.details = details;
  }
}

/** 把节点列表变成 id → 节点、id → 声明下标 的索引（重复 id 取第一个） */
function indexNodes(nodes) {
  const byId = new Map();
  const declaredAt = new Map();
  nodes.forEach((node, index) => {
    const id = String(node?.id ?? '');
    if (!byId.has(id)) {
      byId.set(id, node);
      declaredAt.set(id, index);
    }
  });
  return { byId, declaredAt };
}

/**
 * 规整边列表：字符串化端点、去掉重复边、可选丢弃未知端点。
 * @returns {{from:string,to:string}[]}
 */
function normalizeEdges(edges, byId) {
  const list = Array.isArray(edges) ? edges : [];
  const seen = new Set();
  const normalized = [];
  for (const edge of list) {
    const from = String(edge?.from ?? '');
    const to = String(edge?.to ?? '');
    if (byId && (!byId.has(from) || !byId.has(to))) continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ from, to });
  }
  return normalized;
}

/** 统计每个节点的直接父节点（入边来源），保持边声明顺序 */
function buildParents(ids, edges) {
  const parents = new Map();
  for (const id of ids) parents.set(id, []);
  for (const { from, to } of edges) {
    const list = parents.get(to);
    if (list) list.push(from);
  }
  return parents;
}

/** 从剩余节点里找出一个真实环（沿父方向回溯一定成环），返回环上节点（不重复） */
function findCycle(remainingIds, parents) {
  const inRemaining = new Set(remainingIds);
  const visited = new Set();
  for (const start of remainingIds) {
    if (visited.has(start)) continue;
    const path = [];
    const position = new Map();
    let current = start;
    while (current !== undefined && inRemaining.has(current)) {
      if (position.has(current)) {
        const cycle = path.slice(position.get(current));
        cycle.reverse();
        return cycle;
      }
      if (visited.has(current)) break;
      position.set(current, path.length);
      path.push(current);
      const ps = (parents.get(current) ?? []).filter((id) => inRemaining.has(id));
      current = ps.length ? ps[0] : undefined;
    }
    for (const id of path) visited.add(id);
  }
  return remainingIds.slice();
}

/** 造一个 CYCLE 错误 */
function cycleError(remainingIds, parents) {
  const cycle = findCycle(remainingIds, parents);
  const shown = [...cycle, cycle[0]];
  return new OrchGraphError('CYCLE', `图里有环：${shown.join(' → ')}`, { ids: cycle });
}

/**
 * 按深度分层（Kahn 逐层切分）。同层内严格保持 nodes 数组声明顺序。
 * 有环时抛 OrchGraphError('CYCLE')。
 * @returns {string[][]}
 */
function layerize(nodes, edges) {
  const ids = nodes.map((node) => node.id);
  const { byId } = indexNodes(nodes);
  const normalized = normalizeEdges(edges, byId);

  const indegree = new Map(ids.map((id) => [id, 0]));
  const children = new Map(ids.map((id) => [id, []]));
  for (const { from, to } of normalized) {
    children.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }

  const layers = [];
  const removed = new Set();
  let current = ids.filter((id) => indegree.get(id) === 0);
  while (current.length > 0) {
    layers.push(current);
    const ready = new Set();
    for (const id of current) {
      removed.add(id);
      for (const child of children.get(id)) {
        const left = indegree.get(child) - 1;
        indegree.set(child, left);
        if (left === 0) ready.add(child);
      }
    }
    // 用声明顺序重建下一层，保证稳定
    current = ids.filter((id) => ready.has(id));
  }

  if (removed.size !== ids.length) {
    const remaining = ids.filter((id) => !removed.has(id));
    throw cycleError(remaining, buildParents(ids, normalized));
  }
  return layers;
}

/**
 * 校验整张图。合法返回 { ok:true, order, layers }；非法抛 OrchGraphError。
 * 校验顺序：EMPTY_GRAPH → NODE_DUP → NODE_TYPE → EDGE_UNKNOWN → EDGE_SELF →
 *           CHECK_PARENT → CYCLE → CHECK_COVERAGE
 * @param {{id:string,type:string,goal:string,detail?:string}[]} nodes
 * @param {{from:string,to:string}[]} edges
 * @returns {{ok:true, order:string[], layers:string[][]}}
 */
export function validateGraph(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : [];
  const edgeList = Array.isArray(edges) ? edges : [];

  // 1. 空图
  if (list.length === 0) {
    throw new OrchGraphError('EMPTY_GRAPH', '图是空的：至少要有一个 step 节点', { ids: [] });
  }

  // 2. id 重复
  const { byId } = indexNodes(list);
  const duplicated = [];
  const seenIds = new Set();
  for (const node of list) {
    const id = String(node?.id ?? '');
    if (seenIds.has(id)) {
      if (!duplicated.includes(id)) duplicated.push(id);
    } else {
      seenIds.add(id);
    }
  }
  if (duplicated.length > 0) {
    throw new OrchGraphError('NODE_DUP', `节点 id 重复：${duplicated.join('、')}`, { ids: duplicated });
  }

  // 3. 类型非法
  const badTypes = list.filter((node) => !NODE_TYPES.has(node?.type)).map((node) => String(node.id));
  if (badTypes.length > 0) {
    throw new OrchGraphError('NODE_TYPE', `节点类型只能是 step/check/merge：${badTypes.join('、')}`, {
      ids: badTypes,
    });
  }

  const normalized = normalizeEdges(edgeList, byId);

  // 4. 边端点未知
  const unknown = normalizeEdges(edgeList, null).filter(
    (edge) => !byId.has(edge.from) || !byId.has(edge.to),
  );
  if (unknown.length > 0) {
    const shown = unknown.map((edge) => `${edge.from} → ${edge.to}`);
    throw new OrchGraphError('EDGE_UNKNOWN', `边指向不存在的节点：${shown.join('、')}`, {
      edges: unknown,
    });
  }

  // 5. 自环
  const selfEdges = normalized.filter((edge) => edge.from === edge.to);
  if (selfEdges.length > 0) {
    const ids = selfEdges.map((edge) => edge.from);
    throw new OrchGraphError('EDGE_SELF', `节点不能依赖自己：${ids.join('、')}`, { edges: selfEdges, ids });
  }

  // 6. check 的父节点必须恰好是一个 step
  const ids = list.map((node) => node.id);
  const parents = buildParents(ids, normalized);
  const badChecks = [];
  for (const node of list) {
    if (node.type !== 'check') continue;
    const ps = parents.get(node.id) ?? [];
    if (ps.length !== 1 || byId.get(ps[0])?.type !== 'step') {
      badChecks.push({ checkId: node.id, parents: ps.slice() });
    }
  }
  if (badChecks.length > 0) {
    const first = badChecks[0];
    let message;
    if (first.parents.length === 0) {
      message = `check "${first.checkId}" 没有父节点，它必须挂在一个 step 下面`;
    } else if (first.parents.length === 1) {
      message = `check "${first.checkId}" 的父节点 "${first.parents[0]}" 不是 step，证据要挂在执行节点上`;
    } else {
      message = `check "${first.checkId}" 有 ${first.parents.length} 个父节点，只能有一个 step 父节点`;
    }
    throw new OrchGraphError('CHECK_PARENT', message, {
      ids: badChecks.map((item) => item.checkId),
      checks: badChecks,
    });
  }

  // 7. 环（分层顺带做拓扑排序）
  const layers = layerize(list, normalized);

  // 8. 覆盖：每个 step 至少要有一个 check 直接挂它
  const coverage = checkCoverage(list, normalized);
  const uncovered = list.filter((node) => node.type === 'step' && !coverage.has(node.id)).map((node) => node.id);
  if (uncovered.length > 0) {
    throw new OrchGraphError('CHECK_COVERAGE', `step "${uncovered[0]}" 没有 check 覆盖，它完成了也没有证据`, {
      ids: uncovered,
    });
  }

  return { ok: true, order: layers.flat(), layers };
}

/**
 * 拓扑排序（Kahn 逐层推进）。同层输出顺序按 nodes 数组声明顺序。
 * 有环时抛 OrchGraphError('CYCLE')；未知端点的边直接忽略。
 * @returns {string[]}
 */
export function topologicalOrder(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.length === 0) return [];
  return layerize(list, edges).flat();
}

/**
 * 深度分层：深度 0 开始，层内按声明顺序。
 * 有环时抛 OrchGraphError('CYCLE')；未知端点的边直接忽略。
 * @returns {string[][]}
 */
export function depthLayers(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (list.length === 0) return [];
  return layerize(list, edges).map((layer) => layer.slice());
}

/**
 * 沿 from → to 方向的可达集合（传递闭包），不含起点自身。
 * @returns {Set<string>}
 */
export function downstreamOf(nodeId, edges) {
  const start = String(nodeId ?? '');
  const list = Array.isArray(edges) ? edges : [];
  const children = new Map();
  for (const edge of list) {
    const from = String(edge?.from ?? '');
    const to = String(edge?.to ?? '');
    if (!children.has(from)) children.set(from, new Set());
    children.get(from).add(to);
  }
  const reached = new Set();
  const stack = [...(children.get(start) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === start || reached.has(id)) continue;
    reached.add(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return reached;
}

/**
 * step → 直接覆盖它的 check 列表。只统计合法单父（且父是 step）的 check；
 * 父节点数量不对或父不是 step 的 check 静默跳过，交给 validateGraph 报错。
 * 未被覆盖的 step 不会出现在 Map 里，调用方用 has() 判断覆盖。
 * @returns {Map<string, string[]>}
 */
export function checkCoverage(nodes, edges) {
  const list = Array.isArray(nodes) ? nodes : [];
  const { byId } = indexNodes(list);
  const normalized = normalizeEdges(edges, byId);
  const ids = [...byId.keys()];
  const parents = buildParents(ids, normalized);

  const coverage = new Map();
  for (const node of list) {
    if (node?.type !== 'check') continue;
    const ps = parents.get(node.id) ?? [];
    if (ps.length !== 1) continue;
    const parent = byId.get(ps[0]);
    if (!parent || parent.type !== 'step') continue;
    if (!coverage.has(parent.id)) coverage.set(parent.id, []);
    coverage.get(parent.id).push(node.id);
  }
  return coverage;
}
