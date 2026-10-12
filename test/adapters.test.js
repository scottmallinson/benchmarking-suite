import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { createAdapter } from '../src/adapters/index.js';
import { listen, tmp } from './helpers.js';

const sse = (res, chunks) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`);
  res.end();
};

test('openai-compatible streams text, measures first token, and reads llama-server timings', async () => {
  const s = await listen((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const sent = JSON.parse(body);
      assert.equal(sent.seed, 3);
      assert.equal(sent.stream, true);
      sse(res, [
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        {
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
          timings: { predicted_per_second: 17.5, prompt_per_second: 120 },
        },
        '[DONE]',
      ]);
    });
  });
  try {
    const a = await createAdapter(
      { id: 'm', adapter: 'openai-compatible', options: { baseUrl: `${s.url}/v1`, model: 'x' } },
      '.',
    );
    const out = await a.run({ prompt: 'hi' }, { seed: 3 });
    assert.equal(out.text, 'Hello');
    assert.equal(out.metrics.promptTokens, 10);
    assert.equal(out.metrics.decodeTokensPerSec, 17.5);
    assert.equal(out.metrics.prefillTokensPerSec, 120);
    assert.ok(out.metrics.firstTokenMs >= 0 && out.metrics.firstTokenMs <= out.metrics.totalMs);
  } finally {
    await s.close();
  }
});

test('openai-compatible folds a tool call that arrives in fragments, and flags broken arguments', async () => {
  const s = await listen((req, res) => {
    req.resume();
    req.on('end', () =>
      sse(res, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: 'get_weather', arguments: '{"city":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Leeds"}' } }] } }],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 1, function: { name: 'broken', arguments: '{"a":' } }],
              },
            },
          ],
        },
        '[DONE]',
      ]),
    );
  });
  try {
    const a = await createAdapter(
      { id: 'm', adapter: 'openai-compatible', options: { baseUrl: `${s.url}/v1` } },
      '.',
    );
    const out = await a.run({ prompt: 'x' }, { seed: 1 });
    assert.deepEqual(out.toolCalls[0], {
      name: 'get_weather',
      arguments: { city: 'Leeds' },
      argumentsValid: true,
    });
    assert.equal(out.toolCalls[1].argumentsValid, false);
  } finally {
    await s.close();
  }
});

test('openai-compatible turns an HTTP error into an error that quotes the server', async () => {
  const s = await listen((req, res) => {
    req.resume();
    res.writeHead(500).end('template rejected the layout');
  });
  try {
    const a = await createAdapter(
      { id: 'm', adapter: 'openai-compatible', options: { baseUrl: `${s.url}/v1` } },
      '.',
    );
    await assert.rejects(
      a.run({ prompt: 'x' }, { seed: 1 }),
      /HTTP 500: template rejected the layout/,
    );
  } finally {
    await s.close();
  }
});

test('openai-compatible gives up on silence, not on a long answer', async () => {
  const s = await listen((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
    // then nothing, and the connection stays open
  });
  try {
    const a = await createAdapter(
      {
        id: 'm',
        adapter: 'openai-compatible',
        options: { baseUrl: `${s.url}/v1`, inactivityMs: 150 },
      },
      '.',
    );
    await assert.rejects(a.run({ prompt: 'x' }, { seed: 1 }), /no data|abort/i);
  } finally {
    s.server.closeAllConnections();
    await s.close();
  }
});

test('anthropic reads text and tool use from the Messages response', async () => {
  const s = await listen((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      assert.equal(req.headers['x-api-key'], 'k');
      const sent = JSON.parse(body);
      assert.equal(sent.system, 'be brief');
      assert.equal(sent.messages.length, 1);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          content: [
            { type: 'text', text: 'ok' },
            { type: 'tool_use', name: 't', input: { a: 1 } },
          ],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      );
    });
  });
  process.env.TEST_KEY = 'k';
  try {
    const a = await createAdapter(
      {
        id: 'c',
        adapter: 'anthropic',
        options: { baseUrl: s.url, model: 'm', apiKeyEnv: 'TEST_KEY' },
      },
      '.',
    );
    const out = await a.run(
      {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
      },
      { seed: 1 },
    );
    assert.equal(out.text, 'ok');
    assert.deepEqual(out.toolCalls[0].arguments, { a: 1 });
    assert.equal(out.metrics.completionTokens, 2);
  } finally {
    await s.close();
  }
});

test('a missing API key is reported by name before anything runs', async () => {
  delete process.env.NOPE_KEY;
  await assert.rejects(
    createAdapter({ id: 'c', adapter: 'anthropic', options: { apiKeyEnv: 'NOPE_KEY' } }, '.'),
    /NOPE_KEY/,
  );
});

test('command adapter sends the question on stdin and reads plain text or JSON back', async () => {
  const dir = await tmp();
  await writeFile(
    path.join(dir, 'echo.mjs'),
    `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const {input,seed}=JSON.parse(s);console.log(JSON.stringify({text:'got '+input.prompt+' seed '+seed}))})`,
  );
  await writeFile(
    path.join(dir, 'plain.mjs'),
    `process.stdin.resume();process.stdin.on('end',()=>console.log('plain answer'))`,
  );
  const json = await createAdapter(
    { id: 'c', adapter: 'command', options: { command: 'node', args: ['echo.mjs'] } },
    dir,
  );
  assert.equal((await json.run({ prompt: 'hi' }, { seed: 4 })).text, 'got hi seed 4');
  const plain = await createAdapter(
    {
      id: 'c',
      adapter: 'command',
      options: { command: 'node', args: ['plain.mjs'], stdin: 'text' },
    },
    dir,
  );
  assert.equal((await plain.run({ prompt: 'hi' }, { seed: 1 })).text.trim(), 'plain answer');
});

test('command adapter reports a failing program with its last stderr', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'fail.mjs'), `console.error('model not found');process.exit(3)`);
  const a = await createAdapter(
    { id: 'c', adapter: 'command', options: { command: 'node', args: ['fail.mjs'] } },
    dir,
  );
  await assert.rejects(a.run({ prompt: 'x' }, { seed: 1 }), /exit 3.*model not found/);
});

test('command adapter stops a program that never answers', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'hang.mjs'), `setInterval(()=>{},1000)`);
  const a = await createAdapter(
    {
      id: 'c',
      adapter: 'command',
      options: { command: 'node', args: ['hang.mjs'], timeoutMs: 200 },
    },
    dir,
  );
  await assert.rejects(a.run({ prompt: 'x' }, { seed: 1 }), /no answer after/);
});

test('http adapter posts the question and reads a dotted text path', async () => {
  const s = await listen((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () =>
      res
        .writeHead(200)
        .end(JSON.stringify({ result: { answer: `echo ${JSON.parse(body).input.prompt}` } })),
    );
  });
  try {
    const a = await createAdapter(
      { id: 'h', adapter: 'http', options: { url: s.url, textPath: 'result.answer' } },
      '.',
    );
    assert.equal((await a.run({ prompt: 'yo' }, { seed: 1 })).text, 'echo yo');
  } finally {
    await s.close();
  }
});

test('module adapter runs your own function', async () => {
  const dir = await tmp();
  await writeFile(
    path.join(dir, 'mine.mjs'),
    `export default async (input, { seed }) => 'seed ' + seed + ' ' + input.prompt`,
  );
  const a = await createAdapter({ id: 'x', adapter: 'module', options: { path: 'mine.mjs' } }, dir);
  assert.equal((await a.run({ prompt: 'q' }, { seed: 9 })).text, 'seed 9 q');
});

test('an unknown adapter names the ones that exist', async () => {
  await assert.rejects(createAdapter({ id: 'x', adapter: 'nope' }, '.'), /openai-compatible/);
});
