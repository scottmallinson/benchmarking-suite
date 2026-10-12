import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { run } from '../src/runner.js';
import { buildSite, createViewer } from '../src/serve.js';
import { quiet, tmp, writeSuite } from './helpers.js';

async function finishedRun() {
  const { dir, file } = await writeSuite({
    config: { components: [{ id: 'a', adapter: 'mock', options: { default: 'hello 09:30' } }] },
    scenarios: [{ id: 's', input: 'x', checks: [{ type: 'contains', value: 'hello' }] }],
  });
  const results = path.join(dir, 'out');
  const { outDir } = await run(await loadConfig(file), { out: results, log: quiet });
  await writeFile(path.join(results, 'secret.txt'), 'do not serve');
  return { results, runId: path.basename(outDir) };
}

async function start(opts) {
  const server = createViewer(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

test('the viewer lists runs and serves their summary files', async () => {
  const { results, runId } = await finishedRun();
  const v = await start({ resultsDir: results });
  try {
    const index = await (await fetch(`${v.base}/data/index.json`)).json();
    assert.equal(index[0].id, runId);
    assert.equal((await fetch(`${v.base}/data/${runId}/results.json`)).status, 200);
    assert.equal((await fetch(`${v.base}/`)).status, 200);
  } finally {
    await v.close();
  }
});

test('the viewer serves only summary files: not answers, not env.json, nothing outside the folders', async () => {
  const { results, runId } = await finishedRun();
  const v = await start({ resultsDir: results });
  try {
    for (const p of [
      `/data/${runId}/env.json`,
      `/data/${runId}/answers.jsonl`,
      `/data/${runId}/answers`,
      '/data/..%2Fsecret.txt/results.json',
      `/data/${runId}/..%2F..%2Fsecret.txt`,
      '/..%2Fpackage.json',
      '/%2e%2e/package.json',
      '/data/../../etc/passwd',
    ]) {
      const res = await fetch(`${v.base}${p}`);
      assert.equal(res.status, 404, `${p} must not be served (got ${res.status})`);
    }
  } finally {
    await v.close();
  }
});

test('a password, when set, is required for everything except the health check', async () => {
  const { results } = await finishedRun();
  const v = await start({ resultsDir: results, password: 'hunter2' });
  try {
    assert.equal((await fetch(`${v.base}/`)).status, 401);
    assert.equal((await fetch(`${v.base}/healthz`)).status, 200);
    const bad = Buffer.from('x:wrong').toString('base64');
    const good = Buffer.from('x:hunter2').toString('base64');
    assert.equal(
      (await fetch(`${v.base}/`, { headers: { authorization: `Basic ${bad}` } })).status,
      401,
    );
    assert.equal(
      (await fetch(`${v.base}/`, { headers: { authorization: `Basic ${good}` } })).status,
      200,
    );
  } finally {
    await v.close();
  }
});

test('the static site build includes summaries but not answers unless asked', async () => {
  const { results, runId } = await finishedRun();
  const out = await tmp();
  await buildSite({ resultsDir: results, outDir: out });
  const { stat } = await import('node:fs/promises');
  await stat(path.join(out, 'index.html'));
  await stat(path.join(out, 'data', runId, 'results.json'));
  await assert.rejects(stat(path.join(out, 'data', runId, 'answers')));
  await assert.rejects(stat(path.join(out, 'data', runId, 'env.json')));
  const out2 = await tmp();
  await buildSite({ resultsDir: results, outDir: out2, withAnswers: true });
  await stat(path.join(out2, 'data', runId, 'answers'));
});
