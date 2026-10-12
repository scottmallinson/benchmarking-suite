import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csvRow = (cells) => cells.map(csvCell).join(',');

export async function writeCsv({ outDir, results }) {
  const dims = [...new Set(results.components.flatMap((c) => Object.keys(c.dimensions)))];
  const metricKeys = ['firstTokenMs', 'totalMs', 'decodeTokensPerSec', 'prefillTokensPerSec'];
  const scenarioRows = [
    csvRow([
      'component',
      'scenario',
      'group',
      'runs',
      'pass_rate',
      ...dims.map((d) => `dim_${d}`),
      'distinct_answers',
      ...metricKeys.map((m) => `median_${m}`),
      'failing_checks',
    ]),
  ];
  for (const s of results.scenarios) {
    for (const [cid, row] of Object.entries(s.byComponent)) {
      scenarioRows.push(
        csvRow([
          cid,
          s.id,
          s.group,
          row.runs,
          row.passRate,
          ...dims.map((d) => row.dimensions[d]),
          row.distinctAnswers,
          ...metricKeys.map((m) => row.metrics[m]),
          row.failing.join('; '),
        ]),
      );
    }
  }
  await writeFile(path.join(outDir, 'scores.csv'), scenarioRows.join('\n') + '\n');

  const measureKeys = [
    ...new Set(results.components.flatMap((c) => Object.keys(c.measures))),
  ].sort();
  const profiles = Object.keys(results.rankings);
  const rows = [
    csvRow([
      'component',
      'eligible',
      'failed_gates',
      ...profiles.flatMap((p) => [`${p}_rank`, `${p}_score`]),
      ...dims.map((d) => `dim_${d}`),
      ...measureKeys,
    ]),
  ];
  for (const c of results.components) {
    rows.push(
      csvRow([
        c.id,
        c.eligible,
        Object.entries(c.gates)
          .filter(([, g]) => !g.pass)
          .map(([id]) => id)
          .join('; '),
        ...profiles.flatMap((p) => {
          const r = results.rankings[p].find((x) => x.id === c.id);
          return [r?.rank, r?.score];
        }),
        ...dims.map((d) => c.dimensions[d]),
        ...measureKeys.map((m) => c.measures[m]),
      ]),
    );
  }
  await writeFile(path.join(outDir, 'components.csv'), rows.join('\n') + '\n');
}
