import { bradleyTerry, bradleyTerryIntervals, strengthToScore } from './ranking.js';
import { clamp, mean, median, percentile, rng, round } from './util.js';

export const SCHEMA_VERSION = 1;

const normAnswer = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Weighted mean of check scores, per dimension, for one component on one scenario. */
function scenarioDimensions(runs) {
  const acc = new Map(); // dim -> [sum, weight]
  for (const run of runs) {
    for (const c of run.checks) {
      if (!c.dimension) continue;
      const [s, w] = acc.get(c.dimension) ?? [0, 0];
      acc.set(c.dimension, [s + c.score * c.weight, w + c.weight]);
    }
  }
  return new Map([...acc].filter(([, [, w]]) => w > 0).map(([d, [s, w]]) => [d, s / w]));
}

function runMetrics(runs) {
  const keys = new Set(runs.flatMap((r) => Object.keys(r.output.metrics ?? {})));
  const out = {};
  for (const k of keys) {
    const vals = runs.map((r) => r.output.metrics[k]).filter((v) => typeof v === 'number');
    if (vals.length) out[k] = round(median(vals), 2);
  }
  return out;
}

function curve(value, { good, bad }) {
  return 100 * clamp((value - bad) / (good - bad));
}

function evaluateGates(gates, runs, measures) {
  const out = {};
  const failedRuns = runs.filter(
    (r) =>
      r.output.error || (!String(r.output.text ?? '').trim() && !(r.output.toolCalls ?? []).length),
  );
  for (const [id, spec] of Object.entries(gates)) {
    const base = {
      title: spec.title ?? id,
      severity: spec.severity ?? 'block',
      minPassRate: spec.minPassRate ?? 1,
    };
    if (id === 'responds') {
      if (!runs.length) continue;
      const rate = 1 - failedRuns.length / runs.length;
      const firstError = failedRuns.find((r) => r.output.error)?.output.error;
      out[id] = {
        ...base,
        passRate: rate,
        pass: rate >= base.minPassRate,
        detail: failedRuns.length
          ? `${failedRuns.length} of ${runs.length} runs gave no answer${firstError ? ` (${firstError})` : ''}`
          : null,
      };
    } else if (spec.metric) {
      const v = measures[spec.metric];
      if (v == null) continue;
      const bad = (spec.max != null && v > spec.max) || (spec.min != null && v < spec.min);
      out[id] = {
        ...base,
        passRate: bad ? 0 : 1,
        pass: !bad,
        detail: `${spec.metric} = ${v}${spec.max != null ? ` (limit ${spec.max})` : ` (minimum ${spec.min})`}`,
      };
    } else {
      const results = runs.flatMap((r) => r.checks.filter((c) => c.gate === id));
      if (!results.length) continue;
      const rate = results.filter((c) => c.pass).length / results.length;
      const worst = results.find((c) => !c.pass);
      out[id] = {
        ...base,
        passRate: rate,
        pass: rate >= base.minPassRate,
        detail:
          rate < 1
            ? `${results.filter((c) => !c.pass).length} of ${results.length} checks failed${worst?.detail ? ` (${worst.detail})` : ''}`
            : null,
      };
    }
  }
  return out;
}

function compositeOf(dims, weights) {
  const names = Object.keys(dims).filter((d) => dims[d] != null);
  const w = Object.keys(weights).length ? weights : Object.fromEntries(names.map((d) => [d, 1]));
  const used = names.filter((d) => (w[d] ?? 0) > 0);
  const total = used.reduce((s, d) => s + w[d], 0);
  return {
    value: total ? used.reduce((s, d) => s + dims[d] * w[d], 0) / total : null,
    leftOut: Object.keys(w).filter((d) => (w[d] ?? 0) > 0 && dims[d] == null),
  };
}

/**
 * Turn raw runs into the results every report is written from. Pure: the same inputs always
 * give the same results, which is what lets `bench score` re-apply a changed rule to old answers.
 *
 * records:     [{ component, scenario, rep, output, checks }]
 * componentInfo: [{ id, name, tags, profiles, measures }]  (measures: component-level, e.g. peakRssMb)
 * comparisons: [{ a, b, scenario, winner: "a"|"b"|"tie", source: "judge"|"human" }]
 */
export function buildResults({
  config,
  scenarios,
  componentInfo,
  records,
  comparisons = [],
  bootstrapSeed = 11,
}) {
  const profileNames = Object.keys(config.scoring.profiles);
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const perComponent = new Map();

  for (const info of componentInfo) {
    const runs = records.filter((r) => r.component === info.id);
    const measures = { ...info.measures, ...runMetrics(runs) };
    const scenDims = new Map(); // scenario -> Map(dim -> 0..1)
    const scenarioRows = {};
    for (const s of scenarios) {
      const sr = runs.filter((r) => r.scenario === s.id);
      if (!sr.length) continue;
      const dims = scenarioDimensions(sr);
      scenDims.set(s.id, dims);
      const failing = new Set(
        sr.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => c.name)),
      );
      scenarioRows[s.id] = {
        runs: sr.length,
        passRate:
          sr.filter((r) => r.checks.every((c) => c.pass) && !r.output.error).length / sr.length,
        dimensions: Object.fromEntries([...dims].map(([d, v]) => [d, round(v * 100, 1)])),
        distinctAnswers: new Set(sr.map((r) => normAnswer(r.output.text))).size,
        failing: [...failing],
        metrics: runMetrics(sr),
      };
    }
    const dimNames = [...new Set([...scenDims.values()].flatMap((m) => [...m.keys()]))];
    const dimensions = {};
    for (const d of dimNames) {
      const vals = [...scenDims.values()].map((m) => m.get(d)).filter((v) => v != null);
      dimensions[d] = round(mean(vals) * 100, 1);
    }
    // Measured things (speed, memory) join as dimensions through a "good enough" curve.
    const measured = {};
    for (const [name, spec] of Object.entries(config.scoring.measures)) {
      if (measures[name] == null || !spec.dimension) continue;
      (measured[spec.dimension] ??= []).push(curve(measures[name], spec));
    }
    for (const [d, vals] of Object.entries(measured)) {
      dimensions[d] = round(dimensions[d] == null ? mean(vals) : mean([dimensions[d], ...vals]), 1);
    }
    const groups = {};
    for (const g of new Set(scenarios.map((s) => s.group))) {
      const ids = scenarios.filter((s) => s.group === g && scenarioRows[s.id]).map((s) => s.id);
      if (!ids.length) continue;
      const gd = {};
      for (const d of dimNames) {
        const vals = ids.map((id) => scenDims.get(id)?.get(d)).filter((v) => v != null);
        if (vals.length) gd[d] = round(mean(vals) * 100, 1);
      }
      groups[g] = {
        scenarios: ids.length,
        passRate: round(mean(ids.map((id) => scenarioRows[id].passRate)) * 100, 1),
        dimensions: gd,
      };
    }
    const gates = evaluateGates(config.gates, runs, measures);
    const eligible = Object.values(gates).every((g) => g.pass || g.severity !== 'block');
    perComponent.set(info.id, {
      id: info.id,
      name: info.name ?? info.id,
      tags: info.tags ?? [],
      adapter: info.adapter ?? null,
      startError: info.startError ?? null,
      runs: runs.length,
      measures,
      dimensions,
      fixedDims: Object.fromEntries(Object.keys(measured).map((d) => [d, dimensions[d]])),
      groups,
      gates,
      eligible,
      scenarioRows,
      scenDims,
    });
  }

  // One ranking per profile, among the components that list it (default: all).
  const rankings = {};
  const humanJudge = agreement(comparisons);
  for (const profileName of profileNames) {
    const members = componentInfo
      .filter((c) => (c.profiles ?? profileNames).includes(profileName))
      .map((c) => perComponent.get(c.id));
    const ids = members.map((m) => m.id);
    const pairs = comparisons.filter((c) => ids.includes(c.a) && ids.includes(c.b));
    const strengths = pairs.length ? bradleyTerry(ids, pairs) : null;
    const intervals = pairs.length ? bradleyTerryIntervals(ids, pairs) : {};
    const weights = config.scoring.profiles[profileName].weights ?? {};
    const rows = members.map((m) => {
      const dims = { ...m.dimensions };
      if (strengths) dims.preference = round(strengthToScore(strengths[m.id]), 1);
      const { value, leftOut } = compositeOf(dims, weights);
      return {
        id: m.id,
        name: m.name,
        eligible: m.eligible,
        score: round(value, 1),
        dimensions: dims,
        leftOut,
        strength: strengths ? round(strengths[m.id], 3) : null,
        strengthInterval: intervals[m.id]?.map((v) => round(v, 3)) ?? null,
        _dims: dims,
      };
    });
    const ranked = rows
      .filter((r) => r.eligible && r.score != null)
      .sort((a, b) => b.score - a.score);
    ranked.forEach((r) => (r.rank = 1 + ranked.filter((o) => o.score > r.score).length));
    const bands = rankBands(
      ranked,
      members,
      weights,
      config.scoring.bootstrap,
      bootstrapSeed,
      scenarios,
    );
    for (const r of ranked) r.band = bands[r.id];
    rankings[profileName] = [...ranked, ...rows.filter((r) => !ranked.includes(r))].map(
      ({ _dims, ...rest }) => ({ rank: null, band: null, ...rest }),
    );
  }

  const components = componentInfo.map((info) => {
    const { scenDims, fixedDims, ...rest } = perComponent.get(info.id);
    return rest;
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    components,
    rankings,
    scenarios: scenarios.map((s) => ({
      id: s.id,
      group: s.group,
      title: s.title ?? s.id,
      byComponent: Object.fromEntries(
        components.filter((c) => c.scenarioRows[s.id]).map((c) => [c.id, c.scenarioRows[s.id]]),
      ),
    })),
    pairwise: comparisons.length
      ? {
          comparisons: comparisons.length,
          bySource: countBy(comparisons, (c) => c.source),
          judgeHumanAgreement: humanJudge,
        }
      : null,
  };
}

const countBy = (xs, f) => xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] ?? 0) + 1), o), {});

/** Where judge and human saw the same pair, how often did they pick the same winner? */
export function agreement(comparisons) {
  const key = (c) => `${c.scenario}|${[c.a, c.b].sort().join('|')}`;
  const winnerName = (c) => (c.winner === 'a' ? c.a : c.winner === 'b' ? c.b : 'tie');
  const judge = new Map(
    comparisons.filter((c) => c.source === 'judge').map((c) => [key(c), winnerName(c)]),
  );
  let both = 0;
  let same = 0;
  for (const c of comparisons.filter((x) => x.source === 'human')) {
    const j = judge.get(key(c));
    if (j == null) continue;
    both++;
    if (j === winnerName(c)) same++;
  }
  return both ? { pairs: both, agreed: same, rate: round(same / both, 3) } : null;
}

/**
 * Bootstrap over scenarios: how often does each component land at each rank when the set of
 * scenarios is resampled? The band is the 2.5th to 97.5th percentile of that rank. Components
 * whose bands overlap are not meaningfully different.
 */
function rankBands(ranked, members, weights, rounds, seed, scenarios) {
  if (ranked.length < 2 || !rounds)
    return Object.fromEntries(ranked.map((r) => [r.id, [r.rank, r.rank]]));
  const byId = new Map(members.map((m) => [m.id, m]));
  const scenIds = scenarios.map((s) => s.id);
  const rand = rng(seed);
  const draws = Object.fromEntries(ranked.map((r) => [r.id, []]));
  for (let i = 0; i < rounds; i++) {
    const sample = scenIds.map(() => scenIds[Math.floor(rand() * scenIds.length)]);
    const scores = ranked.map((r) => {
      const m = byId.get(r.id);
      const dims = { ...r._dims };
      for (const d of Object.keys(dims)) {
        if (d in m.fixedDims || d === 'preference') continue;
        const vals = sample.map((id) => m.scenDims.get(id)?.get(d)).filter((v) => v != null);
        if (vals.length) dims[d] = mean(vals) * 100;
      }
      return { id: r.id, value: compositeOf(dims, weights).value };
    });
    for (const s of scores) draws[s.id].push(1 + scores.filter((o) => o.value > s.value).length);
  }
  return Object.fromEntries(
    Object.entries(draws).map(([id, ranks]) => [
      id,
      [Math.floor(percentile(ranks, 0.025)), Math.ceil(percentile(ranks, 0.975))],
    ]),
  );
}
