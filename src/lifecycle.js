import { spawn, execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expandEnv, median, sleep } from './util.js';

const run = promisify(execFile);

/** Resident memory (MB) of a process and everything it started. Linux reads /proc; macOS uses ps. */
export async function treeRssMb(rootPid) {
  const rows = new Map(); // pid -> { ppid, rssKb }
  if (process.platform === 'linux') {
    for (const name of await readdir('/proc').catch(() => [])) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = await readFile(`/proc/${name}/stat`, 'utf8');
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
        const status = await readFile(`/proc/${name}/status`, 'utf8');
        const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
        rows.set(Number(name), { ppid, rssKb: rss });
      } catch {
        /* the process ended while we looked */
      }
    }
  } else if (process.platform !== 'win32') {
    const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=']).catch(() => ({
      stdout: '',
    }));
    for (const line of stdout.trim().split('\n')) {
      const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
      if (pid) rows.set(pid, { ppid, rssKb: rss });
    }
  } else return null;
  if (!rows.has(rootPid)) return null;
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    total += rows.get(pid)?.rssKb ?? 0;
    for (const [child, row] of rows) if (row.ppid === pid) stack.push(child);
  }
  return total / 1024;
}

/** Pages swapped in and out since boot. A change during a run means the machine was short of memory. */
export async function swapCounters() {
  try {
    if (process.platform === 'linux') {
      const text = await readFile('/proc/vmstat', 'utf8');
      return {
        in: Number(/^pswpin (\d+)/m.exec(text)?.[1]),
        out: Number(/^pswpout (\d+)/m.exec(text)?.[1]),
      };
    }
    if (process.platform === 'darwin') {
      const { stdout } = await run('vm_stat');
      return {
        in: Number(/Swapins:\s+(\d+)/.exec(stdout)?.[1]),
        out: Number(/Swapouts:\s+(\d+)/.exec(stdout)?.[1]),
      };
    }
  } catch {
    /* unavailable */
  }
  return null;
}

async function pidMatching(pattern) {
  const { stdout } = await run('pgrep', ['-f', pattern]).catch(() => ({ stdout: '' }));
  return Number(stdout.trim().split('\n')[0]) || null;
}

async function waitHealthy(url, timeoutMs, child, stderrTail) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && hasExited(child)) {
      throw new Error(
        `the process exited (${child.exitCode ?? child.signalCode}) before it was ready. Last output:\n${stderrTail().join('\n')}`,
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(
    `${url} was not healthy after ${Math.round(timeoutMs / 1000)} s${child ? `. Last output:\n${stderrTail().join('\n')}` : ''}`,
  );
}

/**
 * Start whatever a component needs (a model server, a container), wait until it answers,
 * and watch its memory. A component with no `lifecycle` is assumed to be running already.
 *
 * lifecycle: { start: { command, args, cwd, env }, health: { url, timeoutMs },
 *              monitor: "spawned" | { match: "process name pattern" } | false,
 *              stopTimeoutMs, cooldownMs }
 */
export async function startComponent(lifecycle = {}, { baseDir, log = () => {} } = {}) {
  const started = performance.now();
  const watching = Boolean(lifecycle.start || lifecycle.monitor);
  const swap0 = watching ? await swapCounters() : null;
  let child = null;
  const tail = [];
  if (lifecycle.start) {
    child = spawn(
      expandEnv(lifecycle.start.command),
      (lifecycle.start.args ?? []).map((a) => expandEnv(a)),
      {
        cwd: lifecycle.start.cwd ? path.resolve(baseDir, lifecycle.start.cwd) : baseDir,
        env: { ...process.env, ...lifecycle.start.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // Keep the last lines: a server that dies on the way up is quoted, not guessed at.
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (d) => {
        for (const line of String(d).split('\n')) if (line.trim()) tail.push(line);
        while (tail.length > 20) tail.shift();
      });
    }
    child.on('error', (e) => tail.push(`spawn error: ${e.message}`));
  }
  try {
    if (lifecycle.health?.url)
      await waitHealthy(
        lifecycle.health.url,
        lifecycle.health.timeoutMs ?? 120_000,
        child,
        () => tail,
      );
  } catch (e) {
    if (child) await stopChild(child, 5000);
    throw e;
  }
  const loadMs = Math.round(performance.now() - started);

  let pid = child?.pid ?? null;
  if (lifecycle.monitor && typeof lifecycle.monitor === 'object' && lifecycle.monitor.match)
    pid = await pidMatching(lifecycle.monitor.match);
  const samples = [];
  let afterLoadRssMb = null;
  let stopped = false;
  const sampler =
    pid && lifecycle.monitor !== false
      ? (async () => {
          while (!stopped) {
            const mb = await treeRssMb(pid);
            if (mb != null) {
              samples.push(mb);
              afterLoadRssMb ??= mb;
            }
            await sleep(lifecycle.sampleMs ?? 500);
          }
        })()
      : Promise.resolve();

  return {
    loadMs,
    pid,
    async stop() {
      stopped = true;
      await sampler;
      const swap1 = watching ? await swapCounters() : null;
      if (child) await stopChild(child, lifecycle.stopTimeoutMs ?? 10_000);
      if (lifecycle.cooldownMs) await sleep(lifecycle.cooldownMs);
      return {
        loadMs: lifecycle.start ? loadMs : null,
        afterLoadRssMb: afterLoadRssMb == null ? null : Math.round(afterLoadRssMb),
        peakRssMb: samples.length ? Math.round(Math.max(...samples)) : null,
        steadyRssMb: samples.length ? Math.round(median(samples)) : null,
        swapInPages: swap0 && swap1 ? swap1.in - swap0.in : null,
        swapOutPages: swap0 && swap1 ? swap1.out - swap0.out : null,
        leftBehind: child ? isAlive(child.pid) : false,
      };
    },
  };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const hasExited = (child) => child.exitCode != null || child.signalCode != null;

async function stopChild(child, timeoutMs) {
  if (hasExited(child)) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !hasExited(child)) await sleep(50);
  if (!hasExited(child)) {
    child.kill('SIGKILL');
    await sleep(200);
  }
}

export function hostMemory() {
  return {
    totalMb: Math.round(os.totalmem() / 1048576),
    freeMb: Math.round(os.freemem() / 1048576),
  };
}
