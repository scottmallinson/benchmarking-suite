import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adapterNames } from './adapters/index.js';
import { canonical, sha256 } from './util.js';

export const DEFAULT_SPEED_MEASURE = { dimension: 'speed', good: 5000, bad: 60000 };

/** Read a suite from bench.config.json (or .mjs, default-exporting the same object). */
export async function loadConfig(file) {
  const abs = path.resolve(file);
  let raw;
  if (/\.(mjs|js)$/.test(abs)) raw = (await import(pathToFileURL(abs).href)).default;
  else raw = JSON.parse(await readFile(abs, 'utf8'));
  const baseDir = path.dirname(abs);
  const config = {
    name: 'benchmark',
    repeats: 3,
    reports: ['markdown', 'json', 'csv', 'trend', 'human-eval', 'html'],
    ...raw,
    baseDir,
    configFile: abs,
  };
  config.seeds = raw.seeds ?? Array.from({ length: config.repeats }, (_, i) => i + 1);
  config.scoring = {
    measures: { firstTokenMs: DEFAULT_SPEED_MEASURE, ...raw.scoring?.measures },
    profiles: raw.scoring?.profiles ?? { default: { weights: {} } },
    bootstrap: raw.scoring?.bootstrap ?? 1000,
  };
  config.gates = {
    responds: { title: 'Starts and answers every scenario', minPassRate: 1 },
    ...raw.gates,
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const errors = [];
  if (!Array.isArray(config.components) || config.components.length === 0)
    errors.push('`components` must list at least one thing to benchmark');
  const seen = new Set();
  for (const c of config.components ?? []) {
    if (!c.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(c.id))
      errors.push(`component id "${c.id}" must be letters, numbers, dots, dashes or underscores`);
    if (seen.has(c.id)) errors.push(`component id "${c.id}" is used twice`);
    seen.add(c.id);
    if (!adapterNames.includes(c.adapter))
      errors.push(`component "${c.id}": adapter must be one of ${adapterNames.join(', ')}`);
    for (const p of c.profiles ?? [])
      if (!config.scoring.profiles[p]) errors.push(`component "${c.id}": unknown profile "${p}"`);
  }
  if (!Array.isArray(config.scenarios) || config.scenarios.length === 0)
    errors.push('`scenarios` must list at least one file or folder');
  if (!Number.isInteger(config.repeats) || config.repeats < 1)
    errors.push('`repeats` must be a whole number, 1 or more');
  if (config.seeds.length < config.repeats) errors.push('`seeds` has fewer entries than `repeats`');
  if (errors.length)
    throw new Error(`Invalid config ${config.configFile}:\n  - ${errors.join('\n  - ')}`);
}

async function* walk(target) {
  const info = await stat(target);
  if (info.isFile()) return yield target;
  for (const entry of (await readdir(target, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every scenario found under the paths the config lists (.json, .jsonl, .mjs). */
export async function loadScenarios(config, registry) {
  const scenarios = [];
  for (const target of config.scenarios) {
    for await (const file of walk(path.resolve(config.baseDir, target))) {
      const ext = path.extname(file);
      if (file.endsWith('.input.json')) continue; // a big input kept in its own file, named by `inputFile`
      let items;
      if (ext === '.json') items = JSON.parse(await readFile(file, 'utf8'));
      else if (ext === '.jsonl')
        items = (await readFile(file, 'utf8'))
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
      else if (ext === '.mjs') items = (await import(pathToFileURL(file).href)).default;
      else continue;
      for (const s of Array.isArray(items) ? items : [items]) {
        if (s.inputFile)
          s.input = JSON.parse(
            await readFile(path.resolve(path.dirname(file), s.inputFile), 'utf8'),
          );
        scenarios.push({ group: 'default', ...s, file: path.relative(config.baseDir, file) });
      }
    }
  }
  const errors = [];
  const ids = new Set();
  for (const s of scenarios) {
    if (!s.id) errors.push(`${s.file}: a scenario has no id`);
    if (ids.has(s.id)) errors.push(`${s.file}: scenario id "${s.id}" is used twice`);
    ids.add(s.id);
    if (s.input === undefined) errors.push(`${s.id}: no input`);
    for (const c of s.checks ?? []) {
      if (!registry[c.type])
        errors.push(
          `${s.id}: unknown check type "${c.type}" (known: ${Object.keys(registry).join(', ')})`,
        );
      if (c.gate && !config.gates[c.gate]) config.gates[c.gate] = { title: c.gate, minPassRate: 1 };
    }
  }
  if (errors.length) throw new Error(`Invalid scenarios:\n  - ${errors.join('\n  - ')}`);
  return scenarios;
}

/**
 * Two hashes. `inputsHash` covers what was asked and of what (scenario inputs, repeats, seeds):
 * answers from different inputs can never be compared. `scoringHash` covers how answers are
 * judged (checks, weights, gates): it may change after the fact, and `bench score` re-applies it.
 */
export function hashSuite(config, scenarios) {
  const inputs = scenarios.map((s) => ({
    id: s.id,
    group: s.group,
    input: s.input,
    repeats: s.repeats,
  }));
  return {
    inputsHash: sha256(
      canonical({ inputs, seeds: config.seeds.slice(0, config.repeats), repeats: config.repeats }),
    ).slice(0, 12),
    scoringHash: sha256(
      canonical({
        checks: scenarios.map((s) => ({ id: s.id, checks: s.checks, source: s.source })),
        scoring: config.scoring,
        gates: config.gates,
      }),
    ).slice(0, 12),
  };
}
