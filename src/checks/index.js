import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { builtin } from './builtin.js';
import { clamp } from '../util.js';

/** Built-in checks plus any the suite adds under `checks` in its config ({ name: './file.mjs' }). */
export async function loadCheckRegistry(config) {
  const registry = { ...builtin };
  for (const [name, file] of Object.entries(config.checks ?? {})) {
    const mod = await import(pathToFileURL(path.resolve(config.baseDir, file)).href);
    if (typeof mod.default !== 'function')
      throw new Error(
        `check "${name}": ${file} must export a default function (ctx, options) => { pass, score?, detail? }`,
      );
    registry[name] = mod.default;
  }
  return registry;
}

function sourceText(scenario) {
  if (scenario.source != null)
    return typeof scenario.source === 'string' ? scenario.source : JSON.stringify(scenario.source);
  const input = scenario.input;
  if (input?.messages)
    return input.messages
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n');
  return typeof input === 'string' ? input : JSON.stringify(input ?? '');
}

/**
 * Run every check a scenario lists against one answer.
 * dimension: what the check counts towards (default "quality"; none if it is only a gate).
 * gate: the name of the gate it belongs to, if any.
 */
export async function evaluateChecks(scenario, output, registry) {
  const ctx = {
    text: output.text ?? '',
    toolCalls: output.toolCalls ?? [],
    metrics: output.metrics ?? {},
    source: sourceText(scenario),
    scenario,
  };
  const results = [];
  for (const [i, def] of (scenario.checks ?? []).entries()) {
    const fn = registry[def.type];
    let r;
    if (!fn) r = { pass: false, detail: `unknown check type "${def.type}"` };
    else if (output.error) r = { pass: false, detail: 'no answer' };
    else {
      try {
        r = await fn(ctx, def);
      } catch (e) {
        r = { pass: false, detail: `check threw: ${e.message}` };
      }
    }
    results.push({
      id: def.id ?? `${def.type}#${i}`,
      name: def.label ?? def.type,
      type: def.type,
      dimension: def.dimension === undefined ? (def.gate ? null : 'quality') : def.dimension,
      gate: def.gate ?? null,
      weight: def.weight ?? 1,
      pass: Boolean(r.pass),
      score: clamp(r.score ?? (r.pass ? 1 : 0)),
      detail: r.detail ?? null,
    });
  }
  return results;
}
