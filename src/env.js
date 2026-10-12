import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { sha256 } from './util.js';

const run = promisify(execFile);
const git = (cwd, ...args) =>
  run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout.trim());

/**
 * What code is being measured. Either a git checkout (the default is the config's own folder),
 * or a label you provide for things that are not in git (a deployed service, a vendor model).
 * A dirty tree gets a hash of its changes, so "same commit" cannot hide an uncommitted edit.
 */
export async function readRevision(config, override) {
  if (override ?? process.env.BENCH_REVISION)
    return { label: override ?? process.env.BENCH_REVISION, sha: null, dirty: false };
  const spec = config.revision ?? {};
  if (spec.label) return { label: spec.label, sha: null, dirty: false };
  const cwd = path.resolve(config.baseDir, spec.git ?? '.');
  try {
    const sha = await git(cwd, 'rev-parse', 'HEAD');
    const status = await git(cwd, 'status', '--porcelain');
    const dirty = status.length > 0;
    return {
      label: sha.slice(0, 7),
      sha,
      branch: await git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => null),
      dirty,
      dirtyHash: dirty
        ? sha256(status + (await git(cwd, 'diff', 'HEAD').catch(() => ''))).slice(0, 12)
        : null,
    };
  } catch {
    return { label: 'unversioned', sha: null, dirty: false };
  }
}

async function cgroupMemLimitMb() {
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = (await readFile(file, 'utf8')).trim();
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n < 2 ** 50) return Math.round(n / 1048576);
    } catch {
      /* not there */
    }
  }
  return null;
}

/** Everything a reader needs to know about where a run happened. */
export async function readMachine(config) {
  const cpus = os.cpus();
  return {
    label: process.env.BENCH_MACHINE ?? config.machine ?? os.hostname(),
    cpu: cpus[0]?.model?.trim() ?? 'unknown',
    logicalCores: cpus.length,
    memoryGb: Math.round((os.totalmem() / 1073741824) * 10) / 10,
    containerMemoryLimitMb: await cgroupMemLimitMb(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    docker: Boolean(process.env.BENCH_IN_DOCKER),
  };
}

export async function runningProcessNames() {
  try {
    if (process.platform === 'linux') {
      const { readdir } = await import('node:fs/promises');
      const names = [];
      for (const pid of await readdir('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        names.push((await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim());
      }
      return names.filter(Boolean);
    }
    if (process.platform !== 'win32') {
      const { stdout } = await run('ps', ['-A', '-o', 'comm=']);
      return stdout
        .split('\n')
        .map((l) => path.basename(l.trim()))
        .filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Refuse to start on a noisy machine: not enough free memory, or something heavy is open.
 * Returns a list of problems (empty means go).
 */
export async function preflight(config) {
  const spec = config.preflight ?? {};
  const problems = [];
  if (spec.minFreeMemoryMb && Math.round(os.freemem() / 1048576) < spec.minFreeMemoryMb) {
    problems.push(
      `only ${Math.round(os.freemem() / 1048576)} MB of memory is free (the suite wants ${spec.minFreeMemoryMb} MB)`,
    );
  }
  if (spec.forbidProcesses?.length) {
    const names = await runningProcessNames();
    for (const wanted of spec.forbidProcesses) {
      if (names.some((n) => n.toLowerCase().includes(String(wanted).toLowerCase())))
        problems.push(`"${wanted}" is running; quit it so it cannot disturb the measurements`);
    }
  }
  return problems;
}
