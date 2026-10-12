import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Every finished run folder under a results directory, newest first. */
export async function listRuns(dir) {
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    try {
      const r = JSON.parse(await readFile(path.join(dir, name, 'results.json'), 'utf8'));
      out.push({
        id: name,
        startedAt: r.env.startedAt,
        revision: r.env.revision.label,
        machine: r.env.machine.label,
        suite: r.suite.name,
        invalid: Boolean(r.env.invalid),
      });
    } catch {
      /* not a run folder */
    }
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}
