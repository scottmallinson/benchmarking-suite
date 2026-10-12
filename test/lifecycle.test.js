import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { startComponent, treeRssMb } from '../src/lifecycle.js';
import { tmp } from './helpers.js';

const serverScript = `import http from 'node:http';const big=Buffer.alloc(60*1024*1024,1);http.createServer((q,r)=>r.end('ok'+big.length)).listen(Number(process.argv[2]),'127.0.0.1')`;

test('starts a server, waits for health, measures its memory, and stops it', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'srv.mjs'), serverScript);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const c = await startComponent(
    {
      start: { command: 'node', args: ['srv.mjs', String(port)] },
      health: { url: `http://127.0.0.1:${port}/` },
      sampleMs: 50,
    },
    { baseDir: dir },
  );
  await new Promise((r) => setTimeout(r, 300));
  const pid = c.pid;
  const stopping = performance.now();
  const m = await c.stop();
  assert.ok(
    performance.now() - stopping < 3000,
    'a server that stops when asked must not be waited on for the full timeout',
  );
  assert.ok(m.loadMs > 0);
  if (process.platform !== 'win32') {
    assert.ok(
      m.peakRssMb >= 50,
      `expected the 60 MB buffer to show in peak memory, got ${m.peakRssMb}`,
    );
    assert.ok(m.peakRssMb >= m.afterLoadRssMb);
  }
  assert.equal(m.leftBehind, false);
  assert.throws(() => process.kill(pid, 0), 'the server must be gone after stop');
});

test('a server that dies on the way up is quoted, not guessed at', async () => {
  const dir = await tmp();
  await writeFile(
    path.join(dir, 'die.mjs'),
    `console.error('error: model file is corrupt');process.exit(7)`,
  );
  await assert.rejects(
    startComponent(
      {
        start: { command: 'node', args: ['die.mjs'] },
        health: { url: 'http://127.0.0.1:1/', timeoutMs: 5000 },
      },
      { baseDir: dir },
    ),
    /exited \(7\)[\s\S]*model file is corrupt/,
  );
});

test('a server that never becomes healthy is stopped and reported', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'idle.mjs'), `setInterval(()=>{},1000)`);
  await assert.rejects(
    startComponent(
      {
        start: { command: 'node', args: ['idle.mjs'] },
        health: { url: 'http://127.0.0.1:1/', timeoutMs: 800 },
      },
      { baseDir: dir },
    ),
    /not healthy/,
  );
});

test('a component with no lifecycle needs nothing started and reports no load time', async () => {
  const c = await startComponent(undefined, { baseDir: '.' });
  const m = await c.stop();
  assert.equal(m.loadMs, null);
  assert.equal(m.peakRssMb, null);
});

test('treeRssMb reads this process on Linux and macOS', async () => {
  if (process.platform === 'win32') return;
  assert.ok((await treeRssMb(process.pid)) > 10);
  assert.equal(await treeRssMb(2 ** 22 + 5), null);
});

test('a server that ignores the polite stop request is still killed', async () => {
  const dir = await tmp();
  await writeFile(
    path.join(dir, 'stubborn.mjs'),
    `import http from 'node:http';process.on('SIGTERM',()=>{});http.createServer((q,r)=>r.end('ok')).listen(Number(process.argv[2]),'127.0.0.1')`,
  );
  const port = 20000 + Math.floor(Math.random() * 20000);
  const c = await startComponent(
    {
      start: { command: 'node', args: ['stubborn.mjs', String(port)] },
      health: { url: `http://127.0.0.1:${port}/` },
      stopTimeoutMs: 300,
    },
    { baseDir: dir },
  );
  const pid = c.pid;
  const m = await c.stop();
  assert.equal(m.leftBehind, false);
  assert.throws(() => process.kill(pid, 0), 'nothing may be left running after a benchmark');
});
