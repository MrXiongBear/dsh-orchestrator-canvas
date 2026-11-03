// store.js 的测试：runId 形状、原子写往返、并发 seq、坏 JSON、列表排序、清理策略。
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  newRunId,
  runDir,
  readRun,
  writeRun,
  appendEvent,
  listRuns,
  pruneRuns,
} from '../src/store.js';

// 所有用例共用一个临时根，结束时整个删掉
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-'));
after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

let rootSeq = 0;
/** 给单个用例建一个独立的 runs 根目录 */
async function makeRoot() {
  rootSeq += 1;
  const root = path.join(tmpRoot, `runs-${rootSeq}`);
  await fs.mkdir(root, { recursive: true });
  return root;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 读 events.jsonl 并解析成对象数组 */
async function readEvents(root, runId) {
  const file = path.join(runDir(root, runId), 'events.jsonl');
  const text = await fs.readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** 直接播种一个 run 目录（用来精确控制 updatedAt 和体积） */
async function seedRun(root, runId, updatedAt, payloadSize = 10) {
  const dir = runDir(root, runId);
  await fs.mkdir(dir, { recursive: true });
  const run = {
    runId,
    task: 'x'.repeat(payloadSize),
    status: 'accepted',
    createdAt: updatedAt,
    updatedAt,
    nodes: [{ id: 'a' }],
  };
  await fs.writeFile(path.join(dir, 'run.json'), JSON.stringify(run), 'utf8');
}

test('newRunId 形状正确、随机后缀不重复', () => {
  assert.match(newRunId(), /^r-\d{8}-\d{6}-[a-z0-9]{4}$/);
  const fixed = new Date(2026, 9, 29, 5, 6, 7).getTime();
  assert.match(newRunId(fixed), /^r-20261029-050607-[a-z0-9]{4}$/);
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) ids.add(newRunId());
  assert.equal(ids.size, 50);
});

test('runDir 就是 root 下的 runId 目录', () => {
  assert.equal(runDir(tmpRoot, 'r-20261029-050607-abcd'), path.join(tmpRoot, 'r-20261029-050607-abcd'));
});

test('writeRun 后 readRun 原样读回，updatedAt 会被刷新', async () => {
  const root = await makeRoot();
  const runId = 'r-20261029-050607-abcd';
  const run = {
    runId,
    task: '写一份测试报告',
    status: 'running',
    createdAt: '2026-10-29T05:06:07.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  };
  const before = Date.now();
  const returned = await writeRun(root, run);

  assert.equal(returned, run);
  assert.notEqual(returned.updatedAt, '2000-01-01T00:00:00.000Z');
  assert.ok(Date.parse(returned.updatedAt) >= before - 1000, 'updatedAt 应刷新成当前时间');

  const loaded = await readRun(root, runId);
  assert.deepEqual(loaded, returned);
  assert.equal(loaded.task, '写一份测试报告');
  assert.equal(loaded.nodes.length, 3);
});

test('并发 5 次 writeRun 后 events.jsonl 的 seq 不重复、连续递增', async () => {
  const root = await makeRoot();
  const runId = 'r-20261029-050607-wxyz';
  const jobs = [];
  for (let i = 0; i < 5; i += 1) {
    jobs.push(
      writeRun(
        root,
        {
          runId,
          task: `并发任务 ${i}`,
          status: 'running',
          createdAt: '2026-10-29T05:06:07.000Z',
          nodes: [{ id: 'a' }],
        },
        { kind: 'node.start', nodeId: `n${i}` },
      ),
    );
  }
  await Promise.all(jobs);

  const events = await readEvents(root, runId);
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  assert.equal(new Set(events.map((event) => event.seq)).size, 5);

  // 没有 .tmp 残留
  const files = await fs.readdir(runDir(root, runId));
  assert.deepEqual(files.filter((name) => name.endsWith('.tmp')), []);
});

test('写失败也不留 .tmp 残留', async () => {
  const root = await makeRoot();
  const runId = 'r-20261029-050607-fail';
  const dir = runDir(root, runId);
  await fs.mkdir(dir, { recursive: true });

  const circular = { runId, task: '环形引用', status: 'running', nodes: [] };
  circular.self = circular;
  await assert.rejects(writeRun(root, circular), (error) => error instanceof TypeError);

  const files = await fs.readdir(dir);
  assert.deepEqual(files.filter((name) => name.endsWith('.tmp')), []);
  assert.equal(files.includes('run.json'), false);
});

test('坏 JSON 抛 RUN_CORRUPT，文件不存在保留 ENOENT', async () => {
  const root = await makeRoot();
  const runId = 'r-20261029-050607-bad';
  const dir = runDir(root, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'run.json'), '{ 这不是 JSON', 'utf8');

  await assert.rejects(readRun(root, runId), (error) => {
    assert.equal(error.code, 'RUN_CORRUPT');
    assert.match(error.message, /run\.json/);
    return true;
  });

  await assert.rejects(readRun(root, 'r-20261029-050607-none'), (error) => error.code === 'ENOENT');
});

test('listRuns 按 updatedAt 倒序，并带出 status/nodeCount/ok/归属', async () => {
  const root = await makeRoot();
  const runIds = [];
  for (let i = 0; i < 3; i += 1) {
    const runId = `r-list-${i}`;
    runIds.push(runId);
    await writeRun(root, {
      runId,
      task: `任务 ${i}`,
      sessionId: `sess-${i}`,
      cwd: i === 2 ? 'E:/proj' : null,
      status: i === 2 ? 'accepted' : 'running',
      createdAt: new Date(Date.parse('2026-10-29T05:06:07.000Z') + i * 1000).toISOString(),
      nodes: [{ id: 'a' }, { id: 'b' }],
    });
    await sleep(15); // 让 updatedAt 的毫秒不同
  }

  const list = await listRuns(root);
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((item) => item.runId),
    [runIds[2], runIds[1], runIds[0]],
  );
  assert.equal(list[0].ok, true);
  assert.equal(list[0].status, 'accepted');
  assert.equal(list[0].nodeCount, 2);
  assert.equal(list[0].sessionId, 'sess-2');
  assert.equal(list[0].cwd, 'E:/proj');
  assert.equal(list[1].sessionId, 'sess-1');
  assert.equal(list[1].cwd, null);
  assert.equal(list[1].ok, false);

  // 缺字段的 run.json 用兜底值，不炸列表
  const bareDir = runDir(root, 'r-bare');
  await fs.mkdir(bareDir, { recursive: true });
  await fs.writeFile(path.join(bareDir, 'run.json'), JSON.stringify({ runId: 'r-bare', task: '缺字段' }), 'utf8');
  await sleep(10);
  const listAgain = await listRuns(root);
  assert.equal(listAgain.length, 4);
  assert.equal(listAgain[0].runId, 'r-bare');
  assert.equal(listAgain[0].status, 'unknown');
  assert.equal(listAgain[0].nodeCount, 0);
  assert.equal(listAgain[0].ok, false);

  // 目录不存在返回空数组
  assert.deepEqual(await listRuns(path.join(root, '没这个目录')), []);
});

test('appendEvent 自动补 seq/at 并递增，run 不存在抛 ENOENT', async () => {
  const root = await makeRoot();
  const runId = 'r-20261029-050607-evt';
  await writeRun(
    root,
    {
      runId,
      task: '事件测试',
      status: 'running',
      createdAt: '2026-10-29T05:06:07.000Z',
      nodes: [{ id: 'a' }],
    },
    { kind: 'run.start' },
  );

  const second = await appendEvent(root, runId, { kind: 'node.start', nodeId: 'a' });
  const third = await appendEvent(root, runId, { kind: 'node.done', nodeId: 'a', detail: 'ok' });
  assert.equal(second.seq, 2);
  assert.equal(third.seq, 3);
  assert.match(second.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(third.detail, 'ok');

  const events = await readEvents(root, runId);
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.seq),
    [1, 2, 3],
  );

  await assert.rejects(appendEvent(root, 'r-20261029-050607-none', { kind: 'x' }), (error) => error.code === 'ENOENT');
});

test('pruneRuns 按天数删掉过期 run', async () => {
  const root = await makeRoot();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  await seedRun(root, 'old-a', new Date(now - 50 * day).toISOString());
  await seedRun(root, 'old-b', new Date(now - 40 * day).toISOString());
  await seedRun(root, 'fresh', new Date(now).toISOString());

  const result = await pruneRuns(root, { days: 30, maxBytes: 200 * 1024 * 1024 });
  assert.deepEqual(result.removed, ['old-a', 'old-b']);
  assert.equal(result.kept, 1);
  assert.deepEqual((await fs.readdir(root)).sort(), ['fresh']);
});

test('pruneRuns 按总字节上限从旧往新删', async () => {
  const root = await makeRoot();
  const now = Date.now();

  // 4 个 run，每个 run.json 约 4KB；从旧到新
  for (let i = 0; i < 4; i += 1) {
    await seedRun(root, `r-${i}`, new Date(now - (4 - i) * 60 * 1000).toISOString(), 4000);
  }
  const result = await pruneRuns(root, { days: 365, maxBytes: 9000 });
  assert.equal(result.bytes <= 9000, true);
  assert.equal(result.kept, 2);
  assert.ok(result.bytes > 0);
  assert.deepEqual(result.removed, ['r-0', 'r-1']);
  assert.deepEqual((await fs.readdir(root)).sort(), ['r-2', 'r-3']);
});

test('pruneRuns 在空目录和不存在目录上都不报错', async () => {
  const root = await makeRoot();
  assert.deepEqual(await pruneRuns(root), { removed: [], kept: 0, bytes: 0 });
  assert.deepEqual(await pruneRuns(path.join(root, '没这个目录')), { removed: [], kept: 0, bytes: 0 });
});
