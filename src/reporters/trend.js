import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { csvRow } from './csv.js';

const HEADER = [
  'run',
  'started',
  'revision',
  'machine',
  'inputs_hash',
  'scoring_hash',
  'judge',
  'profile',
  'component',
  'eligible',
  'rank',
  'band',
  'score',
  'dimensions',
];

/** trend.csv beside the run folders: one row per component per profile per run, replaced if the run is re-scored. */
export async function writeTrend({ outDir, results }) {
  const file = path.join(path.dirname(outDir), 'trend.csv');
  const run = path.basename(outDir);
  const existing = (await readFile(file, 'utf8').catch(() => ''))
    .split('\n')
    .filter((l) => l.trim());
  const kept = existing.slice(1).filter((l) => !l.startsWith(`${run},`));
  const rows = [];
  for (const [profile, ranking] of Object.entries(results.rankings)) {
    for (const r of ranking) {
      rows.push(
        csvRow([
          run,
          results.env.startedAt,
          results.env.revision.label + (results.env.revision.dirty ? '+dirty' : ''),
          results.env.machine.label,
          results.suite.inputsHash,
          results.suite.scoringHash,
          results.judge?.judge ?? '',
          profile,
          r.id,
          r.eligible,
          r.rank,
          r.band ? `${r.band[0]}-${r.band[1]}` : '',
          r.score,
          Object.entries(r.dimensions)
            .map(([d, v]) => `${d}=${v}`)
            .join(';'),
        ]),
      );
    }
  }
  await writeFile(file, [csvRow(HEADER), ...kept, ...rows].join('\n') + '\n');
}
