import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, loadScenarios } from '../src/config.js';
import { loadCheckRegistry } from '../src/checks/index.js';
import { writeSuite } from './helpers.js';

const ok = { id: 'a', adapter: 'mock' };

test('a config with no components is rejected with a plain message', async () => {
  const { file } = await writeSuite({
    config: { components: [] },
    scenarios: [{ id: 's', input: 'x' }],
  });
  await assert.rejects(loadConfig(file), /at least one thing to benchmark/);
});

test('duplicate component ids and unknown adapters are both reported at once', async () => {
  const { file } = await writeSuite({
    config: { components: [ok, ok, { id: 'b', adapter: 'nope' }] },
    scenarios: [{ id: 's', input: 'x' }],
  });
  await assert.rejects(
    loadConfig(file),
    (e) => /used twice/.test(e.message) && /adapter must be one of/.test(e.message),
  );
});

test('scenario problems are listed together: duplicate ids, missing input, unknown check', async () => {
  const { file } = await writeSuite({
    config: { components: [ok] },
    scenarios: [
      { id: 'd', input: 'x' },
      { id: 'd', input: 'x' },
      { id: 'e' },
      { id: 'f', input: 'x', checks: [{ type: 'wat' }] },
    ],
  });
  const config = await loadConfig(file);
  await assert.rejects(
    loadScenarios(config, await loadCheckRegistry(config)),
    (e) =>
      /used twice/.test(e.message) &&
      /no input/.test(e.message) &&
      /unknown check type "wat"/.test(e.message),
  );
});

test('scenarios load from json, jsonl and a folder tree', async () => {
  const { dir, file } = await writeSuite({
    config: { components: [ok] },
    scenarios: [{ id: 'a', input: 'x' }],
    files: {
      'scenarios/more/b.jsonl': '{"id":"b","input":"y"}\n{"id":"c","input":"z"}\n',
      'scenarios/ignored.txt': 'nothing',
    },
  });
  const config = await loadConfig(file);
  const s = await loadScenarios(config, await loadCheckRegistry(config));
  assert.deepEqual(s.map((x) => x.id).sort(), ['a', 'b', 'c']);
  assert.ok(dir);
});

test('an input can live in its own file', async () => {
  const { file } = await writeSuite({
    config: { components: [ok] },
    scenarios: [{ id: 'a', inputFile: 'big.input.json' }],
    files: { 'scenarios/big.input.json': '{"messages":[{"role":"user","content":"long"}]}' },
  });
  const config = await loadConfig(file);
  const s = await loadScenarios(config, await loadCheckRegistry(config));
  assert.equal(s.find((x) => x.id === 'a').input.messages[0].content, 'long');
});
