import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** answers/<component>/<scenario>.md: every answer, verbatim, with what the checks said about it. */
export async function writeAnswers({ outDir, records, scenarios }) {
  const byKey = new Map();
  for (const r of records) {
    const k = `${r.component}/${r.scenario}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  for (const [k, runs] of byKey) {
    const [component, scenario] = k.split('/');
    const s = scenarios.find((x) => x.id === scenario);
    const dir = path.join(outDir, 'answers', component);
    await mkdir(dir, { recursive: true });
    const parts = [`# ${component} on ${scenario}${s?.title ? `: ${s.title}` : ''}\n`];
    for (const r of runs.sort((a, b) => a.rep - b.rep)) {
      parts.push(`## Run ${r.rep + 1} (seed ${r.seed})\n`);
      if (r.output.error) parts.push(`**Error:** ${r.output.error}\n`);
      parts.push('```text\n' + (r.output.text || '(no text)').replace(/```/g, '` ` `') + '\n```\n');
      for (const c of r.output.toolCalls ?? [])
        parts.push(`Tool call: \`${c.name}(${JSON.stringify(c.arguments)})\`\n`);
      const failed = r.checks.filter((c) => !c.pass);
      parts.push(
        failed.length
          ? `Failed: ${failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}\n`
          : 'All checks passed.\n',
      );
    }
    await writeFile(path.join(dir, `${scenario}.md`), parts.join('\n'));
  }
}
