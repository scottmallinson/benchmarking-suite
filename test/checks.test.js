import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtin } from '../src/checks/builtin.js';
import { evaluateChecks } from '../src/checks/index.js';

const ctx = (text, extra = {}) => ({ text, toolCalls: [], metrics: {}, source: '', ...extra });

test('contains reports partial credit and what is missing', () => {
  const r = builtin.contains(ctx('Standup at 09:30'), { values: ['Standup', '09:30', 'Review'] });
  assert.equal(r.pass, false);
  assert.ok(Math.abs(r.score - 2 / 3) < 1e-9);
  assert.match(r.detail, /Review/);
});

test('contains in any mode needs only one', () => {
  assert.equal(builtin.contains(ctx('hello'), { values: ['x', 'hello'], mode: 'any' }).pass, true);
});

test('not-contains fails on a forbidden phrase, ignoring case', () => {
  assert.equal(
    builtin['not-contains'](ctx('As an AI model'), { values: ['as an ai'] }).pass,
    false,
  );
});

test('length enforces words, lines and bullets', () => {
  assert.equal(builtin.length(ctx('a b c d'), { maxWords: 3 }).pass, false);
  assert.equal(builtin.length(ctx('- a\n- b\n- c'), { maxBullets: 2 }).pass, false);
  assert.equal(builtin.length(ctx('- a\n- b'), { maxBullets: 2 }).pass, true);
});

test('json-valid accepts fenced JSON and names missing keys', () => {
  assert.equal(
    builtin['json-valid'](ctx('```json\n{"a":1}\n```'), { requiredKeys: ['a'] }).pass,
    true,
  );
  assert.match(builtin['json-valid'](ctx('{"a":1}'), { requiredKeys: ['b'] }).detail, /b/);
  assert.equal(builtin['json-valid'](ctx('not json'), {}).pass, false);
});

test('no-repeat catches a repeated line and a repeated phrase, not a single mention', () => {
  assert.equal(
    builtin['no-repeat'](ctx('Your review is waiting.\nYour review is waiting.'), {}).pass,
    false,
  );
  const loop = 'the quick brown fox jumps over the lazy dog '.repeat(3);
  assert.equal(builtin['no-repeat'](ctx(loop), {}).pass, false);
  assert.equal(
    builtin['no-repeat'](ctx('One meeting at nine.\nOne review waiting.'), {}).pass,
    true,
  );
});

test('no-invented flags a time and a name that are not in the source', () => {
  const source = 'Calendar: Standup 09:30 with Priya.';
  assert.equal(
    builtin['no-invented'](ctx('Standup at 9:30 with Priya.', { source }), {}).pass,
    true,
  );
  const bad = builtin['no-invented'](
    ctx('Standup at 09:30, then lunch at 12:15 with Marcus.', { source }),
    {},
  );
  assert.equal(bad.pass, false);
  assert.match(bad.detail, /12:15/);
  assert.match(bad.detail, /Marcus/);
});

test('no-invented does not flag a capital at the start of a sentence or a bullet', () => {
  const source = 'Standup 09:30.';
  assert.equal(
    builtin['no-invented'](
      ctx('Today is quiet.\n- Standup at 09:30.\n* Nothing else.', { source }),
      {},
    ).pass,
    true,
  );
});

test('no-invented numbers are opt-in', () => {
  assert.equal(
    builtin['no-invented'](ctx('You have 7 reviews', { source: 'one review' }), {}).pass,
    true,
  );
  assert.equal(
    builtin['no-invented'](ctx('You have 7 reviews', { source: 'one review' }), {
      kinds: ['number'],
    }).pass,
    false,
  );
});

test('order passes when listed phrases appear in order and fails when swapped', () => {
  assert.equal(
    builtin.order(ctx('09:30 standup then 14:00 review'), { values: ['09:30', '14:00'] }).pass,
    true,
  );
  assert.equal(
    builtin.order(ctx('14:00 review then 09:30 standup'), { values: ['09:30', '14:00'] }).pass,
    false,
  );
});

test('tool-call compares the call to the expected one', () => {
  const call = { name: 'get_weather', arguments: { city: 'Leeds', unit: 'celsius' } };
  const opts = {
    tool: 'get_weather',
    arguments: { city: 'Leeds', unit: { oneOf: ['celsius', 'fahrenheit'] } },
  };
  assert.equal(builtin['tool-call'](ctx('', { toolCalls: [call] }), opts).pass, true);
  const wrong = builtin['tool-call'](
    ctx('', { toolCalls: [{ ...call, arguments: { city: 'Leeds', unit: 'kelvin' } }] }),
    opts,
  );
  assert.equal(wrong.pass, false);
  assert.ok(wrong.score > 0 && wrong.score < 1);
  assert.equal(builtin['tool-call'](ctx(''), opts).score, 0);
  assert.equal(builtin['tool-call'](ctx(''), { expectNone: true }).pass, true);
  assert.equal(
    builtin['tool-call'](ctx('', { toolCalls: [call] }), { expectNone: true }).pass,
    false,
  );
});

test('a check that throws fails rather than stopping the run', async () => {
  const registry = {
    boom: () => {
      throw new Error('bad');
    },
  };
  const [r] = await evaluateChecks({ checks: [{ type: 'boom' }] }, { text: 'x' }, registry);
  assert.equal(r.pass, false);
  assert.match(r.detail, /bad/);
});

test('an unanswered run fails every check', async () => {
  const [r] = await evaluateChecks(
    { checks: [{ type: 'not-contains', values: ['x'] }] },
    { text: '', error: 'HTTP 500' },
    { 'not-contains': builtin['not-contains'] },
  );
  assert.equal(r.pass, false, 'an error must not pass a check that a blank answer would pass');
});

test('a gate-only check counts towards no dimension, an ordinary check towards quality', async () => {
  const registry = { contains: builtin.contains };
  const results = await evaluateChecks(
    {
      checks: [
        { type: 'contains', value: 'a', gate: 'G' },
        { type: 'contains', value: 'a' },
        { type: 'contains', value: 'a', gate: 'G', dimension: 'safety' },
      ],
    },
    { text: 'a' },
    registry,
  );
  assert.deepEqual(
    results.map((r) => r.dimension),
    [null, 'quality', 'safety'],
  );
});
