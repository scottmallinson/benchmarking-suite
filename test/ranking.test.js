import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bradleyTerry, strengthToScore } from '../src/ranking.js';
import { combineVerdicts, parseVerdict } from '../src/judge/index.js';
import { agreement } from '../src/score.js';

test('Bradley-Terry puts the model that wins most on top', () => {
  const cmp = [];
  for (let i = 0; i < 10; i++)
    cmp.push(
      { a: 'x', b: 'y', winner: 'a' },
      { a: 'y', b: 'z', winner: 'a' },
      { a: 'x', b: 'z', winner: 'a' },
    );
  const t = bradleyTerry(['x', 'y', 'z'], cmp);
  assert.ok(t.x > t.y && t.y > t.z);
  assert.ok(strengthToScore(t.x) > 50 && strengthToScore(t.z) < 50);
});

test('Bradley-Terry treats all ties as equal strength', () => {
  const t = bradleyTerry(
    ['x', 'y'],
    [
      { a: 'x', b: 'y', winner: 'tie' },
      { a: 'x', b: 'y', winner: 'tie' },
    ],
  );
  assert.ok(Math.abs(t.x - t.y) < 1e-6);
});

test('a judge that flips with the order of the answers gives a tie, never a win', () => {
  // Always says "A": a position-biased judge. In AB order A is the first answer, in BA order it is the second.
  const v = combineVerdicts('A', 'A');
  assert.equal(v.winner, 'tie');
  assert.equal(v.consistent, false);
});

test('a judge that agrees both ways round gives a win', () => {
  assert.deepEqual(combineVerdicts('A', 'B'), { winner: 'a', consistent: true });
  assert.deepEqual(combineVerdicts('B', 'A'), { winner: 'b', consistent: true });
});

test('a missing verdict skips the pair', () => {
  assert.equal(combineVerdicts('A', null), null);
});

test('verdicts are read from JSON, fenced JSON, and loose text; nonsense is not a verdict', () => {
  assert.equal(parseVerdict('{"winner":"A","reason":"x"}'), 'A');
  assert.equal(parseVerdict('Sure!\n```json\n{"winner": "tie", "reason": "same"}\n```'), 'tie');
  assert.equal(parseVerdict('winner: B'), 'B');
  assert.equal(parseVerdict('I cannot decide'), null);
});

test('judge and human agreement counts only the pairs both saw', () => {
  const cmp = [
    { a: 'x', b: 'y', scenario: 's1', winner: 'a', source: 'judge' },
    { a: 'y', b: 'x', scenario: 's1', winner: 'b', source: 'human' }, // same winner (x), sides swapped
    { a: 'x', b: 'y', scenario: 's2', winner: 'a', source: 'judge' },
    { a: 'x', b: 'y', scenario: 's2', winner: 'b', source: 'human' }, // disagrees
    { a: 'x', b: 'y', scenario: 's3', winner: 'a', source: 'human' }, // judge never saw it
  ];
  assert.deepEqual(agreement(cmp), { pairs: 2, agreed: 1, rate: 0.5 });
});
