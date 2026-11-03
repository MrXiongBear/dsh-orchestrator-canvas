// 工作画布运行记录存储层：run.json 原子写、events.jsonl 追加、列表与清理。
// 只用 node:内置模块；同一 runId 的写操作在进程内串行，避免 seq 撞车。

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** runId 后缀字母表：小写字母 + 数字 */
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 默认清理策略：保留 30 天、总量上限 200MB */
const DEFAULT_PRUNE_OPTS = { days: 30, maxBytes: 200 * 1024 * 1024 };

/**
 * 同一 runId 的写操作串行队列。
 * 结构：Map<runDirKey, Promise>，每次把新任务挂在队尾，失败不毒化后续任务。
 */
const queues = new Map();

/**
 * 把 task 排到 key 的串行队列尾部执行，返回本任务的 Promise。
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueue(key, task) {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  // 队列本身吃掉拒绝，避免前一次失败把后续任务全部带崩
  queues.set(key, next.catch(() => {}));
  return next;
}

/** 取两位补零 */
function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 4 位随机小写字母数字 */
function randomSuffix() {
  const bytes = randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return suffix;
}

/**
 * 生成 runId：r-YYYYMMDD-HHmmss-<4位随机>（时间取本地时区）。
 * @param {number} [now] 毫秒时间戳，测试可注入
 * @returns {string}
 */
export function newRunId(now = Date.now()) {
  const date = new Date(now);
  const ymd = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const hms = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `r-${ymd}-${hms}-${randomSuffix()}`;
}

/**
 * 某个 run 的目录绝对路径。
 * @param {string} rootDir
 * @param {string} runId
 * @returns {string}
 */
export function runDir(rootDir, runId) {
  return path.join(rootDir, runId);
}

/** run.json / events.jsonl 路径 */
function runPaths(rootDir, runId) {
  const dir = runDir(rootDir, runId);
  return { dir, runFile: path.join(dir, 'run.json'), eventsFile: path.join(dir, 'events.jsonl') };
}

/** 从 run 对象里取 runId，兼容 run.id 写法 */
function pickRunId(run) {
  const runId = run?.runId ?? run?.id;
  if (!runId) throw new Error('writeRun 需要 run.runId（或 run.id）才能定位目录');
  return String(runId);
}

/** 读 events.jsonl 里已有的非空行（文件不存在按 0 行算） */
async function readEventLines(eventsFile) {
  let text;
  try {
    text = await fs.readFile(eventsFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return text.split('\n').filter((line) => line.trim() !== '');
}

/**
 * 读 run.json。文件不存在时原样抛 ENOENT；JSON 坏了抛 code='RUN_CORRUPT'。
 * @param {string} rootDir
 * @param {string} runId
 * @returns {Promise<object>}
 */
export async function readRun(rootDir, runId) {
  const { runFile } = runPaths(rootDir, runId);
  const text = await fs.readFile(runFile, 'utf8'); // ENOENT 原样抛出
  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error(`run.json 解析失败（${runFile}）：${cause.message}`);
    error.code = 'RUN_CORRUPT';
    error.details = { runId, runFile };
    error.cause = cause;
    throw error;
  }
}

/**
 * 追加一条事件（不做队列包装，供 writeRun 在已持锁的任务里复用）。
 * 自动补 seq（现有非空行数 + 1）与 at（ISO）。
 * @returns {Promise<object>} 写入的行对象
 */
async function appendEventUnlocked(rootDir, runId, event) {
  const { dir, runFile, eventsFile } = runPaths(rootDir, runId);
  // run 不存在就不允许写事件：先确认 run.json 在，ENOENT 原样抛出
  await fs.access(runFile);

  const lines = await readEventLines(eventsFile);
  const payload = event && typeof event === 'object' ? event : {};
  const line = {
    ...payload,
    seq: lines.length + 1,
    at: typeof payload.at === 'string' ? payload.at : new Date().toISOString(),
  };
  await fs.appendFile(eventsFile, `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}

/**
 * 原子写 run.json；给了 event 就同时追加一行事件。返回写入后的 run。
 * 调用方不用管 updatedAt，这里统一刷新。
 * @param {string} rootDir
 * @param {object} run
 * @param {object} [event]
 * @returns {Promise<object>}
 */
export async function writeRun(rootDir, run, event) {
  const runId = pickRunId(run);
  const { dir, runFile } = runPaths(rootDir, runId);
  const key = path.resolve(dir);

  return enqueue(key, async () => {
    run.updatedAt = new Date().toISOString();
    await fs.mkdir(dir, { recursive: true });

    const tmpFile = path.join(dir, `run.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await fs.open(tmpFile, 'w');
      await handle.writeFile(`${JSON.stringify(run, null, 2)}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      handle = undefined;
      await fs.rm(tmpFile, { force: true });
      throw error;
    }
    try {
      await handle.close();
    } catch (error) {
      await fs.rm(tmpFile, { force: true });
      throw error;
    }
    try {
      await fs.rename(tmpFile, runFile);
    } catch (error) {
      await fs.rm(tmpFile, { force: true });
      throw error;
    }

    if (event) await appendEventUnlocked(rootDir, runId, event);
    return run;
  });
}

/**
 * 追加一条事件。自动补 seq 与 at，并返回该行。
 * @param {string} rootDir
 * @param {string} runId
 * @param {object} event
 * @returns {Promise<object>}
 */
export async function appendEvent(rootDir, runId, event) {
  const key = path.resolve(runDir(rootDir, runId));
  return enqueue(key, () => appendEventUnlocked(rootDir, runId, event));
}

/** 目录大小（递归累计字节） */
async function dirSize(target) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(child);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(child);
        total += stat.size;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return total;
}

/**
 * 列出全部 run，按 updatedAt 倒序（新的在前）。
 * run.json 坏了也照样列出（status 'unknown'），方便调用方看到残骸。
 * @param {string} rootDir
 * @returns {Promise<{runId:string, task:string, sessionId:string|null, cwd:string|null, status:string, createdAt:string|null, updatedAt:string|null, nodeCount:number, ok:boolean}[]>}
 */
export async function listRuns(rootDir) {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const { dir, runFile } = runPaths(rootDir, runId);
    let run = null;
    let updatedAt = null;
    try {
      run = await readRun(rootDir, runId);
    } catch {
      run = null;
    }
    try {
      const stat = await fs.stat(runFile);
      updatedAt = stat.mtime.toISOString();
    } catch {
      try {
        const stat = await fs.stat(dir);
        updatedAt = stat.mtime.toISOString();
      } catch {
        updatedAt = null;
      }
    }
    const status = run?.status ?? 'unknown';
    items.push({
      runId,
      task: run?.task ?? '',
      sessionId: run?.sessionId ?? null,
      cwd: run?.cwd ?? null,
      status,
      createdAt: run?.createdAt ?? updatedAt,
      updatedAt: run?.updatedAt ?? updatedAt,
      nodeCount: run?.nodes?.length ?? 0,
      ok: status === 'accepted',
    });
  }

  items.sort((a, b) => {
    const left = a.updatedAt ?? '';
    const right = b.updatedAt ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return a.runId < b.runId ? 1 : -1;
  });
  return items;
}

/**
 * 清理旧运行目录：先按天数删，再按总字节上限从最旧继续删。
 * @param {string} rootDir
 * @param {{days?:number, maxBytes?:number}} [opts]
 * @returns {Promise<{removed:string[], kept:number, bytes:number}>} bytes 是清理后剩余总量
 */
export async function pruneRuns(rootDir, opts = DEFAULT_PRUNE_OPTS) {
  const { days = DEFAULT_PRUNE_OPTS.days, maxBytes = DEFAULT_PRUNE_OPTS.maxBytes } = opts ?? {};

  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: [], kept: 0, bytes: 0 };
    throw error;
  }

  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const { dir, runFile } = runPaths(rootDir, runId);
    let updatedAtMs = 0;
    try {
      const stat = await fs.stat(runFile);
      updatedAtMs = stat.mtimeMs;
    } catch {
      try {
        const stat = await fs.stat(dir);
        updatedAtMs = stat.mtimeMs;
      } catch {
        updatedAtMs = 0;
      }
    }
    // run.json 里记录的 updatedAt 优先（可能刚从别处恢复），读不到再用 mtime
    try {
      const run = await readRun(rootDir, runId);
      if (run?.updatedAt) {
        const parsed = Date.parse(run.updatedAt);
        if (Number.isFinite(parsed)) updatedAtMs = parsed;
      }
    } catch {
      // 坏了就按 mtime 算，坏目录也该被清掉
    }
    runs.push({ runId, dir, updatedAtMs });
  }

  // 从最旧到最新
  runs.sort((a, b) => (a.updatedAtMs !== b.updatedAtMs ? a.updatedAtMs - b.updatedAtMs : a.runId < b.runId ? -1 : 1));

  let bytes = 0;
  for (const run of runs) run.bytes = await dirSize(run.dir);
  bytes = runs.reduce((sum, run) => sum + run.bytes, 0);

  const removed = [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const kept = [];
  for (const run of runs) {
    if (days > 0 && run.updatedAtMs < cutoff) {
      await fs.rm(run.dir, { recursive: true, force: true });
      removed.push(run.runId);
      bytes -= run.bytes;
    } else {
      kept.push(run);
    }
  }

  // 超字节上限：继续从最旧删（kept 已按 updatedAt 升序）
  while (bytes > maxBytes && kept.length > 0) {
    const victim = kept.shift();
    await fs.rm(victim.dir, { recursive: true, force: true });
    removed.push(victim.runId);
    bytes -= victim.bytes;
  }

  return { removed, kept: kept.length, bytes: Math.max(bytes, 0) };
}
