import { appendFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createAdapter } from './adapters/index.js';
import { evaluateChecks, loadCheckRegistry } from './checks/index.js';
import { hashSuite, loadScenarios } from './config.js';
import { preflight, readMachine, readRevision } from './env.js';
import { startComponent } from './lifecycle.js';
import { buildResults } from './score.js';
import { redact, slug } from './util.js';
import { loadJudgeComparisons } from './judge/index.js';
import { writeReports } from './reporters/index.js';

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

export async function readJsonl(file) {
  try {
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function runFolderName(env, config) {
  const date = env.startedAt.slice(0, 19).replace(/:/g, '').replace('T', '-'); // sorts oldest to newest
  const rev =
    env.revision.label +
    (env.revision.dirty ? `-dirty${env.revision.dirtyHash?.slice(0, 4) ?? ''}` : '');
  return `${date}-${slug(rev)}-${slug(env.machine.label)}`;
}

/**
 * One run: every enabled component, in turn, against the same scenarios on the same revision.
 * Nothing is compared across runs. If the revision moves while the run is going, the run is
 * marked invalid rather than quietly mixing two versions of the code.
 */
export async function run(config, options = {}) {
  const log = options.log ?? ((m) => process.stderr.write(`${m}\n`));
  const registry = await loadCheckRegistry(config);
  const scenarios = await loadScenarios(config, registry);
  const hashes = hashSuite(config, scenarios);
  const only = options.only ? new Set(options.only) : null;
  const components = config.components.filter(
    (c) => c.enabled !== false && (!only || only.has(c.id)),
  );
  if (!components.length) throw new Error('no enabled components to run');

  const revision = await readRevision(config, options.revision);
  if (revision.dirty && config.revision?.requireClean && !options.force) {
    throw new Error(
      `the code under test has uncommitted changes (${revision.dirtyHash}); commit them, or pass --force to run anyway`,
    );
  }
  const problems = await preflight(config);
  if (problems.length && !options.force)
    throw new Error(
      `not starting:\n  - ${problems.join('\n  - ')}\n(--force starts anyway and notes it in the report)`,
    );

  const env = {
    startedAt: new Date().toISOString(),
    revision,
    machine: await readMachine(config),
    suite: {
      name: config.name,
      ...hashes,
      scenarios: scenarios.length,
      repeats: config.repeats,
      seeds: config.seeds.slice(0, config.repeats),
    },
    preflightProblems: problems,
  };

  let outDir;
  let resumed = false;
  if (options.resume) {
    outDir = path.resolve(options.resume);
    const prior = JSON.parse(await readFile(path.join(outDir, 'env.json'), 'utf8'));
    if (
      prior.suite.inputsHash !== hashes.inputsHash ||
      prior.revision.label !== revision.label ||
      prior.revision.dirtyHash !== revision.dirtyHash
    ) {
      throw new Error(
        'cannot resume: the scenarios or the code under test have changed since this run started. Start a new run so every component sees the same thing.',
      );
    }
    Object.assign(env, { startedAt: prior.startedAt });
    resumed = true;
  } else {
    outDir = path.resolve(
      options.out ?? path.join(config.baseDir, 'bench-results'),
      runFolderName(env, config),
    );
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'env.json'), JSON.stringify(env, null, 2));
  await writeFile(
    path.join(outDir, 'suite.json'),
    JSON.stringify(
      { config: redact({ ...config, baseDir: undefined, configFile: undefined }), scenarios },
      null,
      2,
    ),
  );

  const answersFile = path.join(outDir, 'answers.jsonl');
  const componentsDir = path.join(outDir, 'components');
  await mkdir(componentsDir, { recursive: true });
  let records = resumed ? await readJsonl(answersFile) : [];
  const done = new Set();
  if (resumed) {
    for (const c of components) {
      const meta = await readFile(path.join(componentsDir, `${c.id}.json`), 'utf8').catch(
        () => null,
      );
      if (meta) done.add(c.id);
    }
    records = records.filter((r) => done.has(r.component));
    await writeFile(answersFile, jsonl(records));
  }

  const infos = [];
  for (const component of components) {
    if (done.has(component.id)) {
      log(`${component.id}: already finished, keeping its answers`);
      infos.push(
        JSON.parse(await readFile(path.join(componentsDir, `${component.id}.json`), 'utf8')),
      );
      continue;
    }
    infos.push(
      await runComponent({
        config,
        component,
        scenarios,
        registry,
        outDir,
        answersFile,
        componentsDir,
        records,
        options,
        log,
      }),
    );
  }

  // The fairness rule: the code under test must not have moved during the run.
  const after = await readRevision(config, options.revision);
  const moved = after.label !== revision.label || after.dirtyHash !== revision.dirtyHash;
  if (moved) {
    env.invalid = `the code under test changed during the run (${revision.label} to ${after.label}). Results are not comparable; run everything again.`;
    log(`WARNING: ${env.invalid}`);
  }
  env.finishedAt = new Date().toISOString();
  await writeFile(path.join(outDir, 'env.json'), JSON.stringify(env, null, 2));

  return score(config, outDir, {
    scenarios,
    registry,
    infos,
    records,
    env,
    judge: options.judge,
    maxSpend: options.maxSpend,
    log,
  });
}

async function runComponent({
  config,
  component,
  scenarios,
  registry,
  answersFile,
  componentsDir,
  records,
  options,
  log,
}) {
  log(`\n== ${component.id}${component.name ? ` (${component.name})` : ''}`);
  const lifecycle = await startComponent(component.lifecycle, {
    baseDir: config.baseDir,
    log,
  }).catch((e) => {
    log(`${component.id}: could not start: ${e.message}`);
    return { error: e.message };
  });
  const mine = [];
  let warmupMs = null;
  let startError = lifecycle.error ?? null;
  if (!startError) {
    try {
      const adapter = await createAdapter(component, config.baseDir);
      if (component.warmup !== false) {
        // One throwaway question, so the first scored answer is not paying for a cold start.
        const t = performance.now();
        await adapter
          .run(scenarios[0].input, { seed: 0, scenarioId: scenarios[0].id })
          .catch(() => {});
        warmupMs = Math.round(performance.now() - t);
      }
      for (const s of scenarios) {
        const reps = s.repeats ?? config.repeats;
        for (let rep = 0; rep < reps; rep++) {
          const seed = config.seeds[rep] ?? rep + 1;
          let output;
          try {
            output = await adapter.run(s.input, { seed, scenarioId: s.id });
          } catch (e) {
            output = { text: '', toolCalls: [], metrics: {}, error: String(e.message ?? e) };
          }
          const checks = await evaluateChecks(s, output, registry);
          const record = { component: component.id, scenario: s.id, rep, seed, output, checks };
          mine.push(record);
          await appendFile(answersFile, JSON.stringify(record) + '\n');
          const failed = checks.filter((c) => !c.pass).length;
          log(
            `  ${s.id} #${rep + 1}: ${output.error ? `ERROR ${output.error.slice(0, 80)}` : failed ? `${failed} check(s) failed` : 'ok'}${output.metrics?.totalMs ? ` (${output.metrics.totalMs} ms)` : ''}`,
          );
        }
      }
    } catch (e) {
      startError = e.message;
      log(`${component.id}: stopped: ${e.message}`);
    }
  }
  const measured = lifecycle.stop ? await lifecycle.stop() : {};
  if (measured.leftBehind) log(`WARNING: ${component.id}: the process it started is still running`);
  records.push(...mine);
  const info = {
    id: component.id,
    name: component.name ?? component.id,
    tags: component.tags ?? [],
    profiles: component.profiles,
    adapter: component.adapter,
    options: redact(component.options ?? {}),
    startError,
    measures: { ...measured, warmupMs },
  };
  await writeFile(path.join(componentsDir, `${component.id}.json`), JSON.stringify(info, null, 2));
  if (startError && !mine.length) log(`${component.id}: no answers recorded`);
  return info;
}

/** Re-score a finished run folder from the stored answers. Used by `run`, and by `bench score` after a rule changes. */
export async function score(config, outDir, ctx = {}) {
  const log = ctx.log ?? ((m) => process.stderr.write(`${m}\n`));
  const registry = ctx.registry ?? (await loadCheckRegistry(config));
  const scenarios = ctx.scenarios ?? (await loadScenarios(config, registry));
  const env = ctx.env ?? JSON.parse(await readFile(path.join(outDir, 'env.json'), 'utf8'));
  const hashes = hashSuite(config, scenarios);
  if (env.suite.inputsHash !== hashes.inputsHash) {
    throw new Error(
      'the scenarios have changed since these answers were produced; re-scoring would judge answers to different questions. Run again.',
    );
  }
  let records = ctx.records ?? (await readJsonl(path.join(outDir, 'answers.jsonl')));
  // Re-apply the current checks to the stored answers: changing a rule never needs a re-run.
  if (!ctx.records || ctx.rescore) {
    for (const r of records)
      r.checks = await evaluateChecks(
        scenarios.find((s) => s.id === r.scenario),
        r.output,
        registry,
      );
  }
  const componentIds = new Set(records.map((r) => r.component));
  const infos =
    ctx.infos ??
    (await Promise.all(
      config.components
        .filter((c) => componentIds.has(c.id))
        .map(async (c) =>
          JSON.parse(await readFile(path.join(outDir, 'components', `${c.id}.json`), 'utf8')),
        ),
    ));

  const base = buildResults({ config, scenarios, componentInfo: infos, records });
  const judged = await loadJudgeComparisons({
    config,
    outDir,
    scenarios,
    records,
    results: base,
    mode: ctx.judge,
    maxSpend: ctx.maxSpend,
    log,
  });
  const human = await loadHumanComparisons(outDir, log);
  const comparisons = [...judged.comparisons, ...human.comparisons];
  const built = buildResults({ config, scenarios, componentInfo: infos, records, comparisons });

  env.suite = { ...env.suite, scoringHash: hashes.scoringHash };
  const results = {
    ...built,
    suite: env.suite,
    env: { ...env, scoredAt: new Date().toISOString() },
    pairwise: built.pairwise ? { ...built.pairwise, humanConsistency: human.consistency } : null,
    judge: judged.summary,
    notes: [
      ...(env.revision.label === 'unversioned'
        ? [
            'The code under test is not in a git checkout and no --revision was given, so a change to it during the run could not be detected.',
          ]
        : []),
      ...(env.invalid ? [`INVALID RUN: ${env.invalid}`] : []),
      ...(env.preflightProblems?.length
        ? [`Started despite: ${env.preflightProblems.join('; ')}`]
        : []),
      ...judged.notes,
    ],
  };
  await writeFile(path.join(outDir, 'env.json'), JSON.stringify(env, null, 2));
  await writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  await writeReports({ config, outDir, results, records, scenarios, comparisons, log });
  return { outDir, results };
}

async function loadHumanComparisons(outDir, log) {
  const ratingsFile = path.join(outDir, 'ratings.json');
  const keyFile = path.join(outDir, 'human-eval-key.json');
  let ratings;
  let key;
  try {
    ratings = JSON.parse(await readFile(ratingsFile, 'utf8'));
    key = JSON.parse(await readFile(keyFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { comparisons: [], consistency: null };
    throw e;
  }
  const out = [];
  const byPair = new Map();
  for (const r of ratings.ratings ?? []) {
    const pair = key.pairs[r.pairId];
    if (!pair || !['A', 'B', 'tie'].includes(r.choice)) continue;
    const winner = r.choice === 'A' ? 'a' : r.choice === 'B' ? 'b' : 'tie';
    out.push({ a: pair.a, b: pair.b, scenario: pair.scenario, winner, source: 'human' });
    byPair.set(r.pairId, winner === 'tie' ? 'tie' : winner === 'a' ? pair.a : pair.b);
  }
  // Pairs shown twice with the sides swapped: did the rater pick the same component both times?
  let shown = 0;
  let same = 0;
  for (const [id, pair] of Object.entries(key.pairs)) {
    if (!pair.repeatOf || !byPair.has(id) || !byPair.has(pair.repeatOf)) continue;
    shown++;
    if (byPair.get(id) === byPair.get(pair.repeatOf)) same++;
  }
  log(`human ratings: ${out.length} pair(s) from ${path.basename(ratingsFile)}`);
  return { comparisons: out, consistency: shown ? { pairs: shown, same } : null };
}
