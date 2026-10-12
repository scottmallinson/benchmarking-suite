import { rng } from './util.js';

/**
 * Bradley-Terry strengths from pairwise results, by the standard minorise-maximise iteration.
 * comparisons: [{ a, b, winner: "a" | "b" | "tie" }]. A tie counts as half a win each.
 * A small prior (a tie with everyone) keeps a model that never lost from running away to infinity.
 * Returns { id: strength } on a log scale with mean 0.
 */
export function bradleyTerry(ids, comparisons, { prior = 0.05, iterations = 500 } = {}) {
  const wins = new Map(ids.map((i) => [i, 0]));
  const games = new Map(); // "a|b" -> n
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (a, b, w) => {
    wins.set(a, wins.get(a) + w);
    games.set(key(a, b), (games.get(key(a, b)) ?? 0) + 1);
  };
  for (const c of comparisons) {
    if (!wins.has(c.a) || !wins.has(c.b) || c.a === c.b) continue;
    if (c.winner === 'a') add(c.a, c.b, 1);
    else if (c.winner === 'b') add(c.b, c.a, 1);
    else {
      wins.set(c.a, wins.get(c.a) + 0.5);
      wins.set(c.b, wins.get(c.b) + 0.5);
      games.set(key(c.a, c.b), (games.get(key(c.a, c.b)) ?? 0) + 1);
    }
  }
  for (const a of ids)
    for (const b of ids)
      if (a < b) {
        wins.set(a, wins.get(a) + prior / 2);
        wins.set(b, wins.get(b) + prior / 2);
        games.set(key(a, b), (games.get(key(a, b)) ?? 0) + prior);
      }
  let p = new Map(ids.map((i) => [i, 1]));
  for (let it = 0; it < iterations; it++) {
    const next = new Map();
    for (const i of ids) {
      let denom = 0;
      for (const j of ids)
        if (i !== j) denom += (games.get(key(i, j)) ?? 0) / (p.get(i) + p.get(j));
      next.set(i, denom > 0 ? wins.get(i) / denom : p.get(i));
    }
    const logMean = [...next.values()].reduce((s, v) => s + Math.log(v), 0) / ids.length;
    for (const [i, v] of next) next.set(i, v / Math.exp(logMean));
    p = next;
  }
  return Object.fromEntries([...p].map(([i, v]) => [i, Math.log(v)]));
}

/** Probability, from 0 to 100, of beating an average opponent: the "preference" score. */
export function strengthToScore(theta) {
  return 100 / (1 + Math.exp(-theta));
}

/** Resample the comparisons to see how firmly the order holds. Returns { id: [low, high] } strength intervals. */
export function bradleyTerryIntervals(ids, comparisons, { rounds = 200, seed = 7 } = {}) {
  if (comparisons.length === 0) return {};
  const rand = rng(seed);
  const draws = Object.fromEntries(ids.map((i) => [i, []]));
  for (let r = 0; r < rounds; r++) {
    const sample = comparisons.map(() => comparisons[Math.floor(rand() * comparisons.length)]);
    const t = bradleyTerry(ids, sample, { iterations: 100 });
    for (const i of ids) draws[i].push(t[i]);
  }
  return Object.fromEntries(
    ids.map((i) => {
      const s = draws[i].sort((a, b) => a - b);
      return [
        i,
        [s[Math.floor(s.length * 0.025)], s[Math.min(s.length - 1, Math.floor(s.length * 0.975))]],
      ];
    }),
  );
}
