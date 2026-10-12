import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fmt = (v, d = 1) =>
  v == null || Number.isNaN(v)
    ? 'n/a'
    : typeof v === 'number'
      ? String(Math.round(v * 10 ** d) / 10 ** d)
      : v;
const ms = (v) => (v == null ? 'n/a' : v >= 1000 ? `${fmt(v / 1000)} s` : `${Math.round(v)} ms`);
const mb = (v) => (v == null ? 'n/a' : `${Math.round(v)} MB`);
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

export function table(headers, rows) {
  if (!rows.length) return '_nothing to show_\n';
  return (
    [
      `| ${headers.join(' | ')} |`,
      `|${headers.map(() => '---').join('|')}|`,
      ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    ].join('\n') + '\n'
  );
}

/** The latest earlier run in the same folder, on the same machine, that this one can be compared with. */
export async function findPrevious(outDir, results) {
  const root = path.dirname(outDir);
  const me = path.basename(outDir);
  const names = (await readdir(root).catch(() => []))
    .filter((n) => n < me)
    .sort()
    .reverse();
  for (const n of names) {
    try {
      const prev = JSON.parse(await readFile(path.join(root, n, 'results.json'), 'utf8'));
      if (prev.env?.machine?.label === results.env.machine.label && !prev.env.invalid)
        return { name: n, results: prev };
    } catch {
      /* not a run folder */
    }
  }
  return null;
}

const SECTIONS = {
  headline(ctx) {
    const { results } = ctx;
    const out = ['## 1. Headline\n'];
    out.push(
      'A component that fails a blocking gate is not ranked, however well it scores. Rank bands come from resampling the scenarios: components whose bands overlap are not meaningfully different.\n',
    );
    for (const [profile, rows] of Object.entries(results.rankings)) {
      const gateIds = [
        ...new Set(
          rows.flatMap((r) => Object.keys(results.components.find((c) => c.id === r.id).gates)),
        ),
      ];
      const dims = [...new Set(rows.flatMap((r) => Object.keys(r.dimensions)))];
      out.push(`### Profile: ${profile}\n`);
      out.push(
        table(
          ['Rank', 'Band', 'Component', ...gateIds, 'Score', ...dims],
          rows.map((r) => {
            const c = results.components.find((x) => x.id === r.id);
            return [
              r.rank ?? 'n/r',
              r.band ? (r.band[0] === r.band[1] ? r.band[0] : `${r.band[0]}-${r.band[1]}`) : '',
              c.name,
              ...gateIds.map((g) =>
                c.gates[g]
                  ? c.gates[g].pass
                    ? '✓'
                    : c.gates[g].severity === 'block'
                      ? '✗'
                      : '⚠'
                  : '–',
              ),
              fmt(r.score),
              ...dims.map((d) => fmt(r.dimensions[d])),
            ];
          }),
        ),
      );
      const failed = rows.flatMap((r) =>
        Object.entries(results.components.find((c) => c.id === r.id).gates)
          .filter(([, g]) => !g.pass)
          .map(
            ([id, g]) =>
              `- **${r.id}** ${g.severity === 'block' ? 'fails' : 'warns on'} ${g.title} (${id}): ${g.detail ?? `pass rate ${fmt(g.passRate * 100, 0)}%`}`,
          ),
      );
      if (failed.length) out.push(failed.join('\n') + '\n');
      const left = rows
        .filter((r) => r.leftOut.length)
        .map((r) => `${r.id}: ${r.leftOut.join(', ')}`);
      if (left.length)
        out.push(`Left out of the score for lack of evidence: ${left.join('; ')}.\n`);
      out.push(
        '`n/r` = not ranked (a blocking gate failed). ✓ passed, ✗ failed, ⚠ failed but does not block, – not applicable.\n',
      );
    }
    return out.join('\n');
  },

  changes(ctx) {
    const { results, previous } = ctx;
    const out = ['## 2. What changed since the last run\n'];
    if (!previous)
      return out.concat('No earlier run on this machine to compare with.\n').join('\n');
    const p = previous.results;
    out.push(`Compared with \`${previous.name}\` (revision ${p.env.revision.label}).\n`);
    if (p.suite.inputsHash !== results.suite.inputsHash)
      out.push(
        'The scenarios differ from that run, so scores are shown side by side but are **not comparable**.\n',
      );
    if (p.judge?.judge !== results.judge?.judge)
      out.push('The judge differs (or there was none), so judged scores are not comparable.\n');
    const rows = [];
    for (const [profile, ranking] of Object.entries(results.rankings)) {
      for (const r of ranking) {
        const before = p.rankings?.[profile]?.find((x) => x.id === r.id);
        rows.push([
          profile,
          r.id,
          before ? fmt(before.score) : 'new',
          fmt(r.score),
          before?.score != null && r.score != null
            ? (r.score - before.score >= 0 ? '+' : '') + fmt(r.score - before.score)
            : '',
        ]);
      }
    }
    out.push(table(['Profile', 'Component', 'Before', 'Now', 'Change'], rows));
    return out.join('\n');
  },

  measures(ctx) {
    const { results, config } = ctx;
    const target = config.targetMachine;
    const out = ['## 3. Speed and memory\n'];
    if (target && results.env.machine.label !== target)
      out.push(
        `> Measured on **${results.env.machine.label}**, not the target machine **${target}**. For information only; do not compare with results from other machines.\n`,
      );
    out.push(
      table(
        [
          'Component',
          'Load',
          'First word',
          'Write speed',
          'Read speed',
          'Finish (median)',
          'Memory after load',
          'Peak memory',
          'Swapped in',
        ],
        results.components.map((c) => [
          c.name,
          ms(c.measures.loadMs),
          ms(c.measures.firstTokenMs),
          c.measures.decodeTokensPerSec ? `${fmt(c.measures.decodeTokensPerSec)} tok/s` : 'n/a',
          c.measures.prefillTokensPerSec ? `${fmt(c.measures.prefillTokensPerSec)} tok/s` : 'n/a',
          ms(c.measures.totalMs),
          mb(c.measures.afterLoadRssMb),
          mb(c.measures.peakRssMb),
          c.measures.swapInPages == null ? 'n/a' : `${c.measures.swapInPages} pages`,
        ]),
      ),
    );
    out.push(
      'First word, speeds and finish time are medians over every scored run (a throwaway warm-up question is excluded). Memory is the whole process tree of the thing the component started, sampled from outside; `n/a` means there was nothing to watch.\n',
    );
    return out.join('\n');
  },

  groups(ctx) {
    const { results } = ctx;
    const out = ['## 4. Results by group\n'];
    const groups = [...new Set(results.scenarios.map((s) => s.group))];
    out.push(
      table(
        ['Group', 'Scenarios', ...results.components.map((c) => `${c.name}: all checks passed`)],
        groups.map((g) => [
          g,
          results.scenarios.filter((s) => s.group === g).length,
          ...results.components.map((c) =>
            c.groups[g] ? `${fmt(c.groups[g].passRate, 0)}%` : 'n/a',
          ),
        ]),
      ),
    );
    return out.join('\n');
  },

  fixtures(ctx) {
    const { results } = ctx;
    const out = ['## 5. Every scenario\n'];
    for (const c of results.components) {
      out.push(`### ${c.name}\n`);
      out.push(
        table(
          [
            'Scenario',
            'Group',
            'All checks passed',
            'Distinct answers',
            'Median finish',
            'Failing checks',
          ],
          results.scenarios
            .filter((s) => s.byComponent[c.id])
            .map((s) => {
              const r = s.byComponent[c.id];
              return [
                s.id,
                s.group,
                `${fmt(r.passRate * 100, 0)}% of ${r.runs}`,
                r.distinctAnswers,
                ms(r.metrics.totalMs),
                r.failing.join(', ') || '–',
              ];
            }),
        ),
      );
    }
    out.push(
      'Distinct answers: how many different answers the repeated runs gave (1 means perfectly steady).\n',
    );
    return out.join('\n');
  },

  answers(ctx) {
    const { results, records, scenarios } = ctx;
    const out = ['## 6. Best and worst answers, verbatim\n'];
    for (const c of results.components) {
      const mine = results.scenarios
        .filter((s) => s.byComponent[c.id])
        .map((s) => ({ s, pass: s.byComponent[c.id].passRate }));
      if (!mine.length) continue;
      const sorted = [...mine].sort((a, b) => b.pass - a.pass);
      const pick = [
        ...sorted.slice(0, 3).map((x) => ['Best', x]),
        ...sorted
          .slice(-3)
          .reverse()
          .filter((x) => !sorted.slice(0, 3).includes(x))
          .map((x) => ['Worst', x]),
      ];
      out.push(`### ${c.name}\n`);
      for (const [label, { s, pass }] of pick) {
        const rec = records.find((r) => r.component === c.id && r.scenario === s.id && r.rep === 0);
        const text = (
          rec?.output.error ? `ERROR: ${rec.output.error}` : (rec?.output.text ?? '')
        ).slice(0, 700);
        out.push(
          `**${label}: ${s.id}** (${fmt(pass * 100, 0)}% of runs passed everything)\n\n\`\`\`text\n${text.replace(/```/g, '` ` `')}\n\`\`\`\n`,
        );
      }
    }
    return out.join('\n');
  },

  judge(ctx) {
    const { results } = ctx;
    const out = ['## 7. Judge and human ratings\n'];
    const j = results.judge;
    if (!j)
      out.push(
        'No judge was used. Scores come from code checks' +
          (results.pairwise?.bySource?.human ? ' and human ratings.\n' : '.\n'),
      );
    else {
      out.push(
        `- Judge: ${j.judge ?? j.mode} (${j.mode}); ${j.pairs ?? 0} pairs judged both ways round${j.orderConsistency != null ? `, ${fmt(j.orderConsistency * 100, 0)}% gave the same verdict both ways` : ''}${j.spentUsd != null ? `; spent $${j.spentUsd}` : ''}${j.incomplete ? '; **incomplete**' : ''}.`,
      );
      out.push(
        '- Judged scores are only comparable with scores from the same judge and version.\n',
      );
    }
    const pw = results.pairwise;
    if (pw) {
      out.push(
        `- Pairwise results: ${pw.comparisons} (${Object.entries(pw.bySource)
          .map(([k, v]) => `${v} ${k}`)
          .join(', ')}).`,
      );
      if (pw.judgeHumanAgreement)
        out.push(
          `- Judge and human picked the same winner on ${pw.judgeHumanAgreement.agreed} of ${pw.judgeHumanAgreement.pairs} shared pairs (${fmt(pw.judgeHumanAgreement.rate * 100, 0)}%). Below about 70% the judge prompt needs work.`,
        );
      if (pw.humanConsistency)
        out.push(
          `- Human consistency on repeated pairs: ${pw.humanConsistency.same} of ${pw.humanConsistency.pairs}.`,
        );
    }
    return out.join('\n') + '\n';
  },

  notes(ctx) {
    const { results } = ctx;
    const out = ['## 8. Notes and open problems\n'];
    const failedStarts = results.components.filter((c) => c.startError);
    const items = [
      ...results.notes,
      ...failedStarts.map((c) => `${c.id} did not run to completion: ${c.startError}`),
    ];
    out.push(items.length ? items.map((n) => `- ${n}`).join('\n') + '\n' : 'None.\n');
    return out.join('\n');
  },
};

export const DEFAULT_SECTIONS = [
  'headline',
  'changes',
  'measures',
  'groups',
  'fixtures',
  'answers',
  'judge',
  'notes',
];

/** report.md. The sections and their order are fixed unless config.report.sections says otherwise, so two reports can be compared by eye and by diff. */
export async function writeMarkdown(ctx) {
  const { config, outDir, results } = ctx;
  ctx.previous = await findPrevious(outDir, results);
  const r = results.env.revision;
  const m = results.env.machine;
  const head = [
    `# ${config.title ?? config.name}: ${path.basename(outDir)}\n`,
    `- **Revision:** \`${r.label}\`${r.branch ? ` on ${r.branch}` : ''}${r.dirty ? ` (uncommitted changes, hash ${r.dirtyHash})` : ''}`,
    `- **Scenarios:** ${results.suite.scenarios} · ${results.suite.repeats} repeats each · inputs \`${results.suite.inputsHash}\` · scoring \`${results.suite.scoringHash}\``,
    `- **Machine:** ${m.label}: ${m.cpu}, ${m.logicalCores} cores, ${m.memoryGb} GB${m.containerMemoryLimitMb ? ` (container limit ${m.containerMemoryLimitMb} MB)` : ''}, ${m.os}, Node ${m.node}`,
    `- **Judge:** ${results.judge ? `${results.judge.judge ?? results.judge.mode}` : 'none'}`,
    `- **Started:** ${results.env.startedAt}${results.env.finishedAt ? ` · **Finished:** ${results.env.finishedAt}` : ''}`,
    results.env.invalid ? `\n> **INVALID RUN.** ${results.env.invalid}\n` : '',
  ];
  const sections = (config.report?.sections ?? DEFAULT_SECTIONS).map((name) => {
    if (!SECTIONS[name])
      throw new Error(
        `unknown report section "${name}" (known: ${Object.keys(SECTIONS).join(', ')})`,
      );
    return SECTIONS[name](ctx);
  });
  await writeFile(path.join(outDir, 'report.md'), [...head, '', ...sections].join('\n'));
}
