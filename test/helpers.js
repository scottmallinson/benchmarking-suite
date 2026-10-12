import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

export async function tmp(prefix = 'bench-') {
  return mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), prefix));
}

/** Write a suite to a temp folder and return the path to its config. */
export async function writeSuite({ config, scenarios, files = {} }) {
  const dir = await tmp();
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(path.join(dir, 'scenarios', 's.json'), JSON.stringify(scenarios));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  const full = {
    name: 't',
    repeats: 2,
    revision: { label: 'test-rev' },
    machine: 'test',
    reports: ['markdown', 'csv', 'trend', 'human-eval', 'html'],
    scenarios: ['scenarios'],
    ...config,
  };
  await writeFile(path.join(dir, 'bench.config.json'), JSON.stringify(full));
  return { dir, file: path.join(dir, 'bench.config.json') };
}

export function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}

export const quiet = () => {};
