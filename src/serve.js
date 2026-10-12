import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { SITE_DIR } from './reporters/html.js';
import { listRuns } from './runs.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};
const PUBLIC_FILES = [
  'results.json',
  'report.md',
  'report.html',
  'scores.csv',
  'components.csv',
  'human-eval.html',
];

function authorised(req, password) {
  if (!password) return true;
  const given = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  if (!given) return false;
  const pass = Buffer.from(given, 'base64').toString().split(':').slice(1).join(':');
  const a = Buffer.from(pass);
  const b = Buffer.from(password);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A read-only viewer for a results folder: the same page the Vercel build publishes.
 * It only ever serves the summary files of each run (not answers, not env.json), and nothing
 * outside the two folders it was given. Set BENCH_VIEW_PASSWORD to put a password on it.
 */
export function createViewer({ resultsDir, password = process.env.BENCH_VIEW_PASSWORD }) {
  const root = path.resolve(resultsDir);
  return createServer(async (req, res) => {
    const send = (code, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, {
        'content-type': type,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      res.end(body);
    };
    try {
      if (req.url === '/healthz') return send(200, 'ok');
      if (!authorised(req, password)) {
        res.setHeader('www-authenticate', 'Basic realm="benchmarks"');
        return send(401, 'Password needed');
      }
      const url = new URL(req.url, 'http://x');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/data/index.json')
        return send(200, JSON.stringify(await listRuns(root)), TYPES['.json']);
      const data = /^\/data\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (data) {
        if (!PUBLIC_FILES.includes(data[2]) || data[1].startsWith('.'))
          return send(404, 'Not found');
        const file = path.join(root, data[1], data[2]);
        if (!file.startsWith(root + path.sep)) return send(404, 'Not found');
        return send(
          200,
          await readFile(file),
          TYPES[path.extname(file)] ?? 'application/octet-stream',
        );
      }
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.join(SITE_DIR, name);
      if (!file.startsWith(SITE_DIR + path.sep) || !(await stat(file)).isFile())
        return send(404, 'Not found');
      return send(
        200,
        await readFile(file),
        TYPES[path.extname(file)] ?? 'application/octet-stream',
      );
    } catch (e) {
      return send(e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'Not found' : 'Error');
    }
  });
}

/** Static copy of the viewer plus the summary files of every run, for Vercel or any static host. */
export async function buildSite({ resultsDir, outDir, withAnswers = false }) {
  const runs = await listRuns(resultsDir);
  await mkdir(outDir, { recursive: true });
  await cp(SITE_DIR, outDir, { recursive: true });
  for (const run of runs) {
    const dest = path.join(outDir, 'data', run.id);
    await mkdir(dest, { recursive: true });
    for (const f of PUBLIC_FILES.filter((f) => f !== 'human-eval.html')) {
      await cp(path.join(resultsDir, run.id, f), path.join(dest, f)).catch(() => {});
    }
    if (withAnswers)
      await cp(path.join(resultsDir, run.id, 'answers'), path.join(dest, 'answers'), {
        recursive: true,
      }).catch(() => {});
  }
  await mkdir(path.join(outDir, 'data'), { recursive: true });
  await writeFile(path.join(outDir, 'data', 'index.json'), JSON.stringify(runs));
  return runs;
}
