// graph.js 的测试：校验错误码、拓扑/分层稳定性、可达性、check 覆盖映射。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrchGraphError,
  validateGraph,
  topologicalOrder,
  depthLayers,
  downstreamOf,
  checkCoverage,
} from '../src/graph.js';

const step = (id) => ({ id, type: 'step', goal: `执行 ${id}` });
const check = (id) => ({ id, type: 'check', goal: `验收 ${id}` });
const merge = (id) => ({ id, type: 'merge', goal: `汇总 ${id}` });
const edge = (from, to) => ({ from, to });

/** 跑一个应该抛错的调用，断言错误类型和 code，返回错误对象 */
function expectError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof OrchGraphError, `应抛 OrchGraphError，实际是：${error}`);
    assert.equal(error.code, code, `错误码应为 ${code}，实际是 ${error.code}（${error.message}）`);
    return error;
  }
  assert.fail(`应抛 ${code}，但没有抛错`);
}

test('合法图通过校验，返回 ok/order/layers', () => {
  const nodes = [step('a'), check('ac')];
  const edges = [edge('a', 'ac')];
  const result = validateGraph(nodes, edges);
  assert.equal(result.ok, true);
  assert.deepEqual(result.order, ['a', 'ac']);
  assert.deepEqual(result.layers, [['a'], ['ac']]);
});

test('空图报 EMPTY_GRAPH', () => {
  const error = expectError(() => validateGraph([], []), 'EMPTY_GRAPH');
  assert.equal(error.details.ids.length, 0);
});

test('有环报 CYCLE，details.ids 是环上节点', () => {
  const nodes = [step('a'), step('b')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'b'), edge('b', 'a')]), 'CYCLE');
  assert.match(error.message, /有环/);
  assert.deepEqual([...error.details.ids].sort(), ['a', 'b']);
});

test('自环报 EDGE_SELF', () => {
  const nodes = [step('a'), check('ac')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ac'), edge('a', 'a')]), 'EDGE_SELF');
  assert.deepEqual(error.details.edges, [{ from: 'a', to: 'a' }]);
});

test('边端点不存在报 EDGE_UNKNOWN', () => {
  const nodes = [step('a'), check('ac')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ac'), edge('a', 'ghost')]), 'EDGE_UNKNOWN');
  assert.deepEqual(error.details.edges, [{ from: 'a', to: 'ghost' }]);
});

test('节点 id 重复报 NODE_DUP', () => {
  const nodes = [step('a'), step('a'), check('ac')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ac')]), 'NODE_DUP');
  assert.deepEqual(error.details.ids, ['a']);
});

test('节点类型非法报 NODE_TYPE', () => {
  const nodes = [step('a'), { id: 'x', type: 'loop', goal: '奇怪的节点' }, check('ac')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ac')]), 'NODE_TYPE');
  assert.deepEqual(error.details.ids, ['x']);
});

test('check 挂在 merge 下报 CHECK_PARENT', () => {
  const nodes = [step('a'), merge('m'), check('mc')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'm'), edge('m', 'mc')]), 'CHECK_PARENT');
  assert.equal(error.details.ids[0], 'mc');
  assert.match(error.message, /mc/);
});

test('check 有两个父节点报 CHECK_PARENT', () => {
  const nodes = [step('a'), step('b'), check('ab')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ab'), edge('b', 'ab')]), 'CHECK_PARENT');
  assert.deepEqual(error.details.ids, ['ab']);
});

test('step 没有 check 覆盖报 CHECK_COVERAGE', () => {
  const nodes = [step('a'), check('ac'), step('b')];
  const error = expectError(() => validateGraph(nodes, [edge('a', 'ac')]), 'CHECK_COVERAGE');
  assert.deepEqual(error.details.ids, ['b']);
  assert.match(error.message, /没有 check 覆盖/);
});

test('菱形图分层为 3 层，层内按声明顺序', () => {
  const nodes = [step('a'), step('b'), step('c'), merge('d')];
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  const layers = depthLayers(nodes, edges);
  assert.equal(layers.length, 3);
  assert.deepEqual(layers, [['a'], ['b', 'c'], ['d']]);

  // 加上 check 后走完整校验，层数不变
  const fullNodes = [...nodes, check('ac'), check('bc'), check('cc')];
  const fullEdges = [...edges, edge('a', 'ac'), edge('b', 'bc'), edge('c', 'cc')];
  const result = validateGraph(fullNodes, fullEdges);
  assert.equal(result.layers.length, 3);
  assert.deepEqual(result.layers[0], ['a']);
});

test('拓扑顺序在同层内跟随 nodes 声明顺序', () => {
  const nodes = [step('a'), step('c'), step('b'), merge('d')];
  const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
  assert.deepEqual(depthLayers(nodes, edges), [['a'], ['c', 'b'], ['d']]);
  assert.deepEqual(topologicalOrder(nodes, edges), ['a', 'c', 'b', 'd']);
  assert.deepEqual(topologicalOrder([], []), []);
});

test('downstreamOf 返回传递闭包且不含自身', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('x', 'a')];
  assert.deepEqual(downstreamOf('a', edges), new Set(['b', 'c', 'd']));
  assert.equal(downstreamOf('a', edges).has('a'), false);
  assert.deepEqual(downstreamOf('d', edges), new Set());
  assert.deepEqual(downstreamOf('ghost', edges), new Set());
});

test('checkCoverage 映射 step → check 列表，跳过父节点非法的 check', () => {
  const nodes = [step('a'), step('b'), check('a1'), check('a2'), check('b1'), merge('m'), check('mc')];
  const edges = [
    edge('a', 'a1'),
    edge('a', 'a2'),
    edge('b', 'b1'),
    edge('a', 'm'),
    edge('m', 'mc'),
  ];
  const coverage = checkCoverage(nodes, edges);
  assert.deepEqual(coverage.get('a'), ['a1', 'a2']);
  assert.deepEqual(coverage.get('b'), ['b1']);
  assert.equal(coverage.size, 2);
  assert.equal(coverage.has('m'), false);
});

test('重复边被去重，校验仍通过', () => {
  const nodes = [step('a'), check('ac')];
  const edges = [edge('a', 'ac'), edge('a', 'ac'), edge('a', 'ac')];
  const result = validateGraph(nodes, edges);
  assert.equal(result.ok, true);
  assert.deepEqual(result.order, ['a', 'ac']);
});
