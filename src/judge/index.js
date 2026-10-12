import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAdapter } from '../adapters/index.js';
import { agreement } from '../score.js';

const DEFAULT_RUBRIC =
  'Prefer the answer that is accurate to the task material, invents nothing, follows the instructions in the task, and is most useful to the reader in plain words. Do not prefer an answer for being longer.';

function renderInput(input) {
  if (input?.messages)
    return input.messages
      .map(
        (m) =>
          `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
      )
      .join('\n');
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
}

export function buildPrompt(config, scenario, answerA, answerB) {
  const rubric = config.judge?.rubric ?? DEFAULT_RUBRIC;
  const notes = scenario.notes ?? scenario.reference;
  return [
    'You are judging two answers to the same task. You do not know which system wrote which.',
    `Rubric: ${rubric}`,
    `TASK:\n${renderInput(scenario.input)}`,
    notes
      ? `FACTS THE ANSWER SHOULD RESPECT:\n${typeof notes === 'string' ? notes : JSON.stringify(notes)}`
      : '',
    `ANSWER A:\n${answerA || '(empty)'}`,
    `ANSWER B:\n${answerB || '(empty)'}`,
    'Reply with JSON only, no other text: {"winner": "A" or "B" or "tie", "reason": "one sentence"}',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function parseVerdict(raw) {
  const text = String(raw ?? '');
  const block = /\{[\s\S]*?\}/.exec(text)?.[0];
  if (block) {
    try {
      const w = String(JSON.parse(block).winner ?? '')
        .trim()
        .toUpperCase();
      if (w === 'A' || w === 'B') return w;
      if (w === 'TIE') return 'tie';
    } catch {
      /* fall back to a looser read */
    }
  }
  const m = /"?winner"?\s*[:=]\s*"?(A|B|tie)\b/i.exec(text);
  return m ? (m[1].toUpperCase() === 'TIE' ? 'tie' : m[1].toUpperCase()) : null;
}

/** An answer pair is judged twice, once each way round. Disagreement between the two is a tie, never a win. */
export function combineVerdicts(ab, ba) {
  if (ab == null || ba == null) return null;
  const first = ab === 'A' ? 'a' : ab === 'B' ? 'b' : 'tie';
  const second = ba === 'A' ? 'b' : ba === 'B' ? 'a' : 'tie';
  return { winner: first === second ? first : 'tie', consistent: first === second };
}

/** The pairs worth judging: each pair of eligible components, on each scenario both answered. */
export function planPairs({ config, scenarios, records, results }) {
  const eligible = results.components.filter((c) => c.eligible).map((c) => c.id);
  const first = new Map(); // "component|scenario" -> answer of repeat 0
  for (const r of records)
    if (r.rep === 0 && !r.output.error)
      first.set(`${r.component}|${r.scenario}`, r.output.text ?? '');
  const pairs = [];
  for (const s of scenarios) {
    if (s.judge === false) continue;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = first.get(`${eligible[i]}|${s.id}`);
        const b = first.get(`${eligible[j]}|${s.id}`);
        if (a == null || b == null) continue;
        pairs.push({ scenario: s, a: eligible[i], b: eligible[j], answerA: a, answerB: b });
      }
    }
  }
  return pairs;
}

const idOf = (p, order) => `${p.scenario.id}|${p.a}|${p.b}|${order}`;

function requestsFor(config, pairs) {
  const out = [];
  for (const p of pairs) {
    out.push({
      id: idOf(p, 'AB'),
      pair: p,
      prompt: buildPrompt(config, p.scenario, p.answerA, p.answerB),
    });
    out.push({
      id: idOf(p, 'BA'),
      pair: p,
      prompt: buildPrompt(config, p.scenario, p.answerB, p.answerA),
    });
  }
  return out;
}

function collect(pairs, rawById) {
  const comparisons = [];
  let consistent = 0;
  let judged = 0;
  for (const p of pairs) {
    const v = combineVerdicts(
      parseVerdict(rawById.get(idOf(p, 'AB'))),
      parseVerdict(rawById.get(idOf(p, 'BA'))),
    );
    if (!v) continue;
    judged++;
    if (v.consistent) consistent++;
    comparisons.push({
      a: p.a,
      b: p.b,
      scenario: p.scenario.id,
      winner: v.winner,
      source: 'judge',
      consistent: v.consistent,
    });
  }
  return { comparisons, judged, consistent };
}

/**
 * Judge the answers, if asked to. Modes:
 *   none  (default)  no judge; code checks and human ratings only
 *   file             write judge-requests.json for any outside tool (a workflow tool, a notebook, a person);
 *                    read judgements.json back: { "<id>": "<raw reply>", "_judge": "<name and version>" }
 *   on               call the judge adapter in the config (config.judge.adapter / options)
 * Judging never happens during the benchmark, so it cannot slow the thing being measured.
 */
export async function loadJudgeComparisons({
  config,
  outDir,
  scenarios,
  records,
  results,
  mode,
  maxSpend,
  log,
}) {
  const chosen = mode ?? 'none';
  const notes = [];
  if (chosen === 'none') {
    const cached = await readFile(path.join(outDir, 'judgements.json'), 'utf8').catch(() => null);
    return {
      comparisons: [],
      summary: cached
        ? { mode: 'none', note: 'judgements.json is present but no judge was selected' }
        : null,
      notes,
    };
  }
  const pairs = planPairs({ config, scenarios, records, results });
  const requests = requestsFor(config, pairs);
  if (!requests.length)
    return {
      comparisons: [],
      summary: { mode: chosen, requests: 0 },
      notes: ['Judge: nothing to compare (fewer than two eligible components).'],
    };

  if (chosen === 'file') {
    const file = path.join(outDir, 'judgements.json');
    const raw = await readFile(file, 'utf8').catch(() => null);
    if (!raw) {
      await writeFile(
        path.join(outDir, 'judge-requests.json'),
        JSON.stringify(
          Object.fromEntries(requests.map((r) => [r.id, { prompt: r.prompt }])),
          null,
          2,
        ),
      );
      notes.push(
        `Judge: wrote ${requests.length} requests to judge-requests.json. Have your tool write judgements.json, then run \`bench score <folder> --judge file\`.`,
      );
      return {
        comparisons: [],
        summary: { mode: 'file', requests: requests.length, status: 'waiting' },
        notes,
      };
    }
    const json = JSON.parse(raw);
    if (!json._judge)
      throw new Error(
        'judgements.json needs a "_judge" entry naming the judge and its version, so scores are never compared across judges',
      );
    const map = new Map(Object.entries(json).filter(([k]) => k !== '_judge'));
    const got = collect(pairs, map);
    return {
      comparisons: got.comparisons,
      summary: {
        mode: 'file',
        judge: json._judge,
        requests: requests.length,
        answered: map.size,
        pairs: got.judged,
        orderConsistency: got.judged ? got.consistent / got.judged : null,
      },
      notes,
    };
  }

  // Calling a judge adapter. The version must be named so a silent model update cannot change scores unseen.
  const spec = config.judge;
  if (!spec?.adapter || !spec.version)
    throw new Error(
      '--judge on needs `judge.adapter` and `judge.version` in the config (pin the version)',
    );
  const adapter = await createAdapter(
    { id: 'judge', adapter: spec.adapter, options: spec.options },
    config.baseDir,
  );
  const cacheFile = path.join(outDir, 'judgements.jsonl');
  const cached = new Map();
  for (const line of (await readFile(cacheFile, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.judge === spec.version) cached.set(row.id, row.raw);
  }
  const cap = maxSpend ?? spec.maxSpend ?? 10;
  const price = spec.pricing;
  let spent = 0;
  let stopped = null;
  const raws = new Map(cached);
  for (const r of requests) {
    if (raws.has(r.id)) continue;
    const estimate = price
      ? ((r.prompt.length / 4) * price.inputPerMTok + 150 * price.outputPerMTok) / 1e6
      : 0;
    if (price && spent + estimate > cap) {
      stopped = `stopped at the spend cap ($${cap}) after $${spent.toFixed(2)}`;
      break;
    }
    try {
      const out = await adapter.run(
        { prompt: r.prompt, maxTokens: 300 },
        { seed: 1, scenarioId: r.pair.scenario.id },
      );
      raws.set(r.id, out.text);
      if (price) {
        const m = out.metrics ?? {};
        spent +=
          ((m.promptTokens ?? r.prompt.length / 4) * price.inputPerMTok +
            (m.completionTokens ?? 100) * price.outputPerMTok) /
          1e6;
      }
      await appendFile(
        cacheFile,
        JSON.stringify({ id: r.id, judge: spec.version, raw: out.text }) + '\n',
      );
    } catch (e) {
      stopped = `stopped: ${e.message}. Run again to continue where it left off.`;
      break;
    }
    if (raws.size % 25 === 0) log(`judge: ${raws.size}/${requests.length}`);
  }
  if (stopped) notes.push(`Judge ${stopped}`);
  const got = collect(pairs, raws);
  return {
    comparisons: got.comparisons,
    summary: {
      mode: 'on',
      judge: spec.version,
      requests: requests.length,
      answered: raws.size,
      pairs: got.judged,
      orderConsistency: got.judged ? got.consistent / got.judged : null,
      spentUsd: price ? Math.round(spent * 100) / 100 : null,
      incomplete: raws.size < requests.length,
    },
    notes,
  };
}

export { agreement };
