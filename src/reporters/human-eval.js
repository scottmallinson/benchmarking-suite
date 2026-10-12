import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { rng } from '../util.js';

const renderInput = (input) =>
  input?.messages
    ? input.messages
        .map(
          (m) =>
            `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
        )
        .join('\n\n')
    : typeof input === 'string'
      ? input
      : JSON.stringify(input, null, 2);

/**
 * Choose which pairs a person should look at. Most useful first: scenarios you marked
 * `humanRate: true` or whose group is in `humanEval.groups`, then pairs the judge found close or
 * got inconsistent, then neighbours in the ranking. A few pairs repeat with the sides swapped,
 * to measure how consistent the rater is.
 */
export function pickPairs({ config, results, records, scenarios, comparisons }) {
  const spec = config.humanEval ?? {};
  const max = spec.maxPairs ?? 50;
  const rand = rng(spec.seed ?? 3);
  const first = new Map();
  for (const r of records)
    if (r.rep === 0 && !r.output.error)
      first.set(`${r.component}|${r.scenario}`, r.output.text ?? '');
  const rankOrder =
    Object.values(results.rankings)[0]
      ?.filter((r) => r.eligible)
      .map((r) => r.id) ?? [];
  const eligible = results.components.filter((c) => c.eligible).map((c) => c.id);
  const judged = new Map(
    comparisons
      .filter((c) => c.source === 'judge')
      .map((c) => [`${c.scenario}|${[c.a, c.b].sort().join('|')}`, c]),
  );
  const candidates = [];
  for (const s of scenarios) {
    if (s.humanRate === false) continue;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const [x, y] = [eligible[i], eligible[j]];
        if (!first.has(`${x}|${s.id}`) || !first.has(`${y}|${s.id}`)) continue;
        const j0 = judged.get(`${s.id}|${[x, y].sort().join('|')}`);
        const adjacent = Math.abs(rankOrder.indexOf(x) - rankOrder.indexOf(y)) === 1;
        const priority =
          s.humanRate === true || (spec.groups ?? []).includes(s.group)
            ? 0
            : j0 && (j0.winner === 'tie' || !j0.consistent)
              ? 1
              : adjacent
                ? 2
                : 3;
        candidates.push({ s, x, y, priority, tiebreak: rand() });
      }
    }
  }
  candidates.sort((p, q) => p.priority - q.priority || p.tiebreak - q.tiebreak);
  const chosen = candidates.slice(0, max);
  const pairs = chosen.map((c, n) => {
    const flip = rand() < 0.5;
    const [a, b] = flip ? [c.y, c.x] : [c.x, c.y];
    return { id: `p${n + 1}`, scenario: c.s.id, a, b };
  });
  const repeats = Math.min(spec.consistencyRepeats ?? 3, pairs.length);
  for (let k = 0; k < repeats; k++) {
    const src = pairs[Math.floor(rand() * pairs.length)];
    pairs.push({
      id: `p${pairs.length + 1}`,
      scenario: src.scenario,
      a: src.b,
      b: src.a,
      repeatOf: src.id,
    });
  }
  // Shuffle so repeats are not next to their originals, and the order carries no meaning.
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}

const safeJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/**
 * human-eval.html: a single self-contained page, opened in any browser, no server and no network.
 * It shows the situation and two anonymous answers; the rater picks A, B or tie, and downloads
 * ratings.json, which goes in the run folder. The key to who wrote what stays in human-eval-key.json.
 * Once a key exists it is kept, so ratings already given stay valid when the run is re-scored.
 */
export async function writeHumanEval(ctx) {
  const { config, outDir, results, records, scenarios, comparisons } = ctx;
  const keyFile = path.join(outDir, 'human-eval-key.json');
  let key = await readFile(keyFile, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (!key) {
    const picked = pickPairs({
      config,
      results,
      records,
      scenarios,
      comparisons: comparisons.filter((c) => c.source === 'judge'),
    });
    key = {
      pairs: Object.fromEntries(picked.map((p) => [p.id, p])),
      order: picked.map((p) => p.id),
    };
    await writeFile(keyFile, JSON.stringify(key, null, 2));
  }
  const answer = (component, scenario) =>
    records.find((r) => r.component === component && r.scenario === scenario && r.rep === 0)?.output
      .text ?? '';
  const items = key.order.map((id) => {
    const p = key.pairs[id];
    const s = scenarios.find((x) => x.id === p.scenario);
    return {
      id,
      title: s?.title ?? s?.id,
      situation: renderInput(s?.input),
      notes: typeof s?.notes === 'string' ? s.notes : undefined,
      a: answer(p.a, p.scenario),
      b: answer(p.b, p.scenario),
    };
  });
  const run = path.basename(outDir);
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Rate answers: ${run.replace(/[<>&"]/g, '')}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#16181a;--card:#fff;--line:#d5d7d4;--accent:#2c5c7a}
@media(prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#ececea;--card:#1d2125;--line:#363b40;--accent:#7fb0d0}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:18px;margin:0 0 4px} .muted{opacity:.7;font-size:13px}
pre{white-space:pre-wrap;word-wrap:break-word;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;margin:0;max-height:420px;overflow:auto;font:13px/1.45 ui-monospace,monospace}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0} @media(max-width:700px){.cols{grid-template-columns:1fr}}
button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.on{border-color:var(--accent);outline:2px solid var(--accent)} .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
progress{width:100%}
</style></head><body><main>
<h1>Which answer is better?</h1>
<p class="muted">Answers are anonymous and in random order. Pick the one you would rather have received. Stopping early is fine; download your ratings whenever you like and drop <code>ratings.json</code> into the run folder.</p>
<progress id="bar" value="0" max="1"></progress><div class="muted" id="count"></div>
<h2 id="title" style="font-size:16px"></h2>
<div class="muted">The situation</div><pre id="situation"></pre>
<div class="cols"><div><strong>Answer A</strong><pre id="a"></pre></div><div><strong>Answer B</strong><pre id="b"></pre></div></div>
<div class="row" id="choices"></div>
<div class="row"><label><input type="checkbox" id="invented"> One of them invented something</label><label><input type="checkbox" id="unhelpful"> Neither is helpful</label></div>
<div class="row"><button id="prev">Back</button><button id="next">Next</button><button id="download">Download ratings.json</button></div>
<script type="application/json" id="data">${safeJson({ run, items })}</script>
<script>
(function(){
var data=JSON.parse(document.getElementById('data').textContent);var items=data.items;var i=0;
var store='bench-ratings-'+data.run;var ratings={};
try{ratings=JSON.parse(localStorage.getItem(store)||'{}')}catch(e){}
function save(){try{localStorage.setItem(store,JSON.stringify(ratings))}catch(e){}}
function $(id){return document.getElementById(id)}
function show(){var it=items[i];if(!it){$('title').textContent='No pairs to rate. A run needs at least two components that passed every blocking gate.';return}
$('title').textContent=it.title;$('situation').textContent=it.situation+(it.notes?'\\n\\nNotes: '+it.notes:'');$('a').textContent=it.a||'(empty)';$('b').textContent=it.b||'(empty)';
var r=ratings[it.id]||{};$('invented').checked=!!r.invented;$('unhelpful').checked=!!r.unhelpful;
var c=$('choices');c.textContent='';[['A','A is better'],['tie','About the same'],['B','B is better']].forEach(function(o){var b=document.createElement('button');b.textContent=o[1];if(r.choice===o[0])b.className='on';b.onclick=function(){ratings[it.id]={choice:o[0],invented:$('invented').checked,unhelpful:$('unhelpful').checked};save();if(i<items.length-1)i++;show()};c.appendChild(b)});
var done=Object.keys(ratings).length;$('bar').max=items.length||1;$('bar').value=done;$('count').textContent=(i+1)+' of '+items.length+' - '+done+' rated'}
['invented','unhelpful'].forEach(function(id){$(id).onchange=function(){var it=items[i];if(ratings[it.id]){ratings[it.id][id]=$(id).checked;save()}}});
$('prev').onclick=function(){if(i>0){i--;show()}};$('next').onclick=function(){if(i<items.length-1){i++;show()}};
$('download').onclick=function(){var out={run:data.run,ratedAt:new Date().toISOString(),ratings:Object.keys(ratings).map(function(k){return{pairId:k,choice:ratings[k].choice,invented:!!ratings[k].invented,unhelpful:!!ratings[k].unhelpful}})};
var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));a.download='ratings.json';a.click()};
show()})();
</script></main></body></html>`;
  await writeFile(path.join(outDir, 'human-eval.html'), page);
  ctx.log?.(`human-eval.html: ${items.length} pairs to rate`);
}
