// Results viewer. Reads results.json files; draws everything with textContent, never innerHTML,
// because result files can contain model output and component names that must not run as markup.

const app = document.getElementById('app');
const picker = document.getElementById('picker');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat())
    if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const n = (v, d = 1) =>
  v == null || Number.isNaN(v) ? '–' : String(Math.round(v * 10 ** d) / 10 ** d);
const ms = (v) => (v == null ? '–' : v >= 1000 ? `${n(v / 1000)} s` : `${Math.round(v)} ms`);

function table(headers, rows, numeric = []) {
  return h(
    'div',
    { class: 'scroll' },
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          headers.map((t, i) => h('th', { class: numeric.includes(i) ? 'num' : null }, t)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((r) =>
          h(
            'tr',
            null,
            r.map((c, i) => h('td', { class: numeric.includes(i) ? 'num' : null }, c)),
          ),
        ),
      ),
    ),
  );
}

function scatter(points, xLabel, yLabel) {
  const W = 640,
    H = 300,
    m = 44,
    right = 130;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${yLabel} against ${xLabel}`);
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e);
  };
  for (let t = 0; t <= 100; t += 25) {
    const x = m + ((W - m - right) * t) / 100,
      y = H - m - ((H - 2 * m) * t) / 100;
    el('line', { x1: x, x2: x, y1: m / 2, y2: H - m, class: 'grid' });
    el('line', { x1: m, x2: W - right, y1: y, y2: y, class: 'grid' });
    el('text', { x, y: H - m + 14, 'text-anchor': 'middle' }, t);
    el('text', { x: m - 6, y: y + 4, 'text-anchor': 'end' }, t);
  }
  el('text', { x: W / 2, y: H - 6, 'text-anchor': 'middle' }, xLabel);
  el(
    'text',
    { x: 12, y: H / 2, transform: `rotate(-90 12 ${H / 2})`, 'text-anchor': 'middle' },
    yLabel,
  );
  for (const p of points) {
    const x = m + ((W - m - right) * p.x) / 100,
      y = H - m - ((H - 2 * m) * p.y) / 100;
    el('circle', { cx: x, cy: y, r: 6, class: p.eligible ? 'dot' : 'out' });
    el('text', { x: x + 9, y: y + 4 }, p.label);
  }
  return svg;
}

function view(results, base) {
  const out = [];
  const r = results.env.revision,
    m = results.env.machine;
  if (results.env.invalid)
    out.push(h('div', { class: 'banner' }, `Invalid run. ${results.env.invalid}`));
  out.push(
    h(
      'div',
      { class: 'meta' },
      h(
        'span',
        null,
        'Revision ',
        h('span', { class: 'mono' }, r.label + (r.dirty ? ' (uncommitted changes)' : '')),
      ),
      h('span', null, `Machine ${m.label}: ${m.cpu}, ${m.logicalCores} cores, ${m.memoryGb} GB`),
      h('span', null, `${results.suite.scenarios} scenarios × ${results.suite.repeats} repeats`),
      h('span', null, `Judge: ${results.judge?.judge ?? 'none'}`),
      h('span', null, results.env.startedAt),
      base ? h('a', { href: `${base}report.md` }, 'report.md') : null,
    ),
  );

  for (const [profile, rows] of Object.entries(results.rankings)) {
    const gateIds = [
      ...new Set(
        rows.flatMap((x) => Object.keys(results.components.find((c) => c.id === x.id).gates)),
      ),
    ];
    const dims = [...new Set(rows.flatMap((x) => Object.keys(x.dimensions)))];
    out.push(h('h2', null, `Ranking: ${profile}`));
    out.push(
      table(
        ['Rank', 'Band', 'Component', ...gateIds, 'Score', ...dims],
        rows.map((x) => {
          const c = results.components.find((k) => k.id === x.id);
          return [
            x.rank ?? 'n/r',
            x.band ? (x.band[0] === x.band[1] ? x.band[0] : `${x.band[0]}–${x.band[1]}`) : '',
            c.name,
            ...gateIds.map((g) => {
              const gate = c.gates[g];
              return gate
                ? h(
                    'span',
                    {
                      class: gate.pass ? 'pass' : gate.severity === 'block' ? 'fail' : 'warn',
                      title: gate.detail ?? gate.title,
                    },
                    gate.pass ? '✓' : gate.severity === 'block' ? '✗' : '⚠',
                  )
                : '–';
            }),
            n(x.score),
            ...dims.map((d) => n(x.dimensions[d])),
          ];
        }),
        Array.from({ length: dims.length + 1 }, (_, i) => i + 3 + gateIds.length),
      ),
    );
    const xDim = dims.includes('speed') ? 'speed' : dims.find((d) => d !== 'quality');
    if (dims.includes('quality') && xDim) {
      out.push(h('h3', null, `Quality against ${xDim}`));
      out.push(
        scatter(
          rows
            .filter((x) => x.dimensions.quality != null && x.dimensions[xDim] != null)
            .map((x) => ({
              label: x.name,
              x: x.dimensions[xDim],
              y: x.dimensions.quality,
              eligible: x.eligible,
            })),
          `${xDim} (0–100)`,
          'quality (0–100)',
        ),
      );
    }
  }

  out.push(h('h2', null, 'Speed and memory'));
  out.push(
    table(
      [
        'Component',
        'Load',
        'First word',
        'Write tok/s',
        'Read tok/s',
        'Finish',
        'Memory after load',
        'Peak memory',
      ],
      results.components.map((c) => [
        c.name,
        ms(c.measures.loadMs),
        ms(c.measures.firstTokenMs),
        n(c.measures.decodeTokensPerSec),
        n(c.measures.prefillTokensPerSec),
        ms(c.measures.totalMs),
        c.measures.afterLoadRssMb ? `${c.measures.afterLoadRssMb} MB` : '–',
        c.measures.peakRssMb ? `${c.measures.peakRssMb} MB` : '–',
      ]),
      [1, 2, 3, 4, 5, 6, 7],
    ),
  );

  const groups = [...new Set(results.scenarios.map((s) => s.group))];
  out.push(h('h2', null, 'Results by group (every check passed)'));
  out.push(
    table(
      ['Group', ...results.components.map((c) => c.name)],
      groups.map((g) => [
        g,
        ...results.components.map((c) => (c.groups[g] ? `${n(c.groups[g].passRate, 0)}%` : '–')),
      ]),
      results.components.map((_, i) => i + 1),
    ),
  );

  out.push(h('h2', null, 'Every scenario'));
  out.push(
    table(
      ['Scenario', 'Group', ...results.components.map((c) => c.name)],
      results.scenarios.map((s) => [
        s.id,
        s.group,
        ...results.components.map((c) => {
          const row = s.byComponent[c.id];
          return row
            ? h('span', { title: row.failing.join(', ') }, `${n(row.passRate * 100, 0)}%`)
            : '–';
        }),
      ]),
      results.components.map((_, i) => i + 2),
    ),
  );

  if (results.notes?.length) {
    out.push(h('h2', null, 'Notes'));
    out.push(
      h(
        'ul',
        null,
        results.notes.map((t) => h('li', null, t)),
      ),
    );
  }
  return out;
}

async function main() {
  const embedded = document.getElementById('embedded');
  if (embedded) return app.replaceChildren(...view(JSON.parse(embedded.textContent), null));
  let index;
  try {
    index = await (await fetch('data/index.json')).json();
  } catch {
    return app.replaceChildren(
      h('p', null, 'No results found. Run a benchmark, then build or serve the results folder.'),
    );
  }
  if (!index.length) return app.replaceChildren(h('p', null, 'No runs yet.'));
  const select = h(
    'select',
    { 'aria-label': 'Run' },
    index.map((r) => h('option', { value: r.id }, `${r.id}${r.invalid ? ' (invalid)' : ''}`)),
  );
  picker.replaceChildren(select);
  const load = async () => {
    const run = index.find((r) => r.id === select.value);
    const base = `data/${run.id}/`;
    const results = await (await fetch(`${base}results.json`)).json();
    app.replaceChildren(...view(results, base));
  };
  select.addEventListener('change', load);
  await load();
}

main().catch((e) =>
  app.replaceChildren(h('p', { class: 'fail' }, `Could not show results: ${e.message}`)),
);
