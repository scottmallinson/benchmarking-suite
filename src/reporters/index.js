import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeMarkdown } from './markdown.js';
import { writeCsv } from './csv.js';
import { writeTrend } from './trend.js';
import { writeHumanEval } from './human-eval.js';
import { writeHtml } from './html.js';
import { writeAnswers } from './answers.js';

/**
 * The shape of the output is a list of reporters in the config. Built in:
 *   markdown (report.md), json (results.json, always written), csv (scores.csv, components.csv),
 *   trend (trend.csv, one row per component per run), human-eval (human-eval.html), html (report.html).
 * Anything starting with "." or "/" is your own module: export default async (ctx) => {}
 * where ctx = { config, outDir, results, records, scenarios, comparisons, log }.
 */
const builtins = {
  markdown: writeMarkdown,
  json: async () => {},
  csv: writeCsv,
  trend: writeTrend,
  'human-eval': writeHumanEval,
  html: writeHtml,
};

export async function writeReports(ctx) {
  await writeAnswers(ctx);
  for (const name of ctx.config.reports) {
    if (builtins[name]) await builtins[name](ctx);
    else if (/^[./]/.test(name)) {
      const mod = await import(pathToFileURL(path.resolve(ctx.config.baseDir, name)).href);
      if (typeof mod.default !== 'function')
        throw new Error(`reporter ${name} must export a default function`);
      await mod.default(ctx);
    } else
      throw new Error(
        `unknown reporter "${name}" (built in: ${Object.keys(builtins).join(', ')}; or a path to your own module)`,
      );
  }
}
