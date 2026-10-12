import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Your own JavaScript. options.path points at a module whose default export is
 * async (input, { seed, options }) => { text, toolCalls?, metrics? } (or just a string).
 * Use this for anything the other adapters cannot reach: an SDK, a local library, a pipeline.
 */
export async function create({ options = {}, baseDir }) {
  if (!options.path) throw new Error('the module adapter needs options.path');
  const mod = await import(pathToFileURL(path.resolve(baseDir, options.path)).href);
  const fn = typeof mod.default === 'function' ? mod.default : mod.run;
  if (typeof fn !== 'function') throw new Error(`${options.path} must export a default function`);
  return {
    async run(input, ctx) {
      const started = performance.now();
      const result = await fn(input, { ...ctx, options });
      const answer = typeof result === 'string' ? { text: result } : result;
      return {
        text: answer.text ?? '',
        toolCalls: answer.toolCalls ?? [],
        metrics: { totalMs: Math.round(performance.now() - started), ...answer.metrics },
      };
    },
  };
}
