import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { run, score } from '../src/runner.js';
import { quiet, tmp, writeSuite } from './helpers.js';

const scenarios = [
  {
    id: 'day',
    group: 'briefs',
    title: 'A day',
    input: { messages: [{ role: 'user', content: 'Calendar: Standup 09:30 with Priya.' }] },
    checks: [
      { type: 'contains', values: ['09:30'], label: 'keeps the time' },
      { type: 'no-invented', gate: 'G3', label: 'invents nothing' },
    ],
  },
  {
    id: 'empty',
    group: 'briefs',
    input: { prompt: 'Calendar empty' },
    checks: [{ type: 'no-invented', gate: 'G3' }],
  },
];

const good = {
  id: 'good',
  adapter: 'mock',
  options: { answers: { day: 'Standup at 09:30 with Priya.', empty: 'Nothing today.' } },
};
const inventor = {
  id: 'inventor',
  adapter: 'mock',
  options: {
    answers: {
      day: 'Standup 09:30, then a call with Marcus at 16:45.',
      empty: 'Call with Marcus at 11:00.',
    },
  },
};
const broken = {
  id: 'broken',
  adapter: 'mock',
  options: { default: 'x', failOn: ['day', 'empty'] },
};

async function suite(components, extra = {}) {
  const { dir, file } = await writeSuite({ config: { components, ...extra }, scenarios });
  return { dir, config: await loadConfig(file) };
}

test('a full run writes the same folder structure every time', async () => {
  const { dir, config } = await suite([good, inventor]);
  const { outDir } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  for (const f of [
    'env.json',
    'suite.json',
    'answers.jsonl',
    'results.json',
    'report.md',
    'report.html',
    'scores.csv',
    'components.csv',
    'human-eval.html',
    'human-eval-key.json',
    'answers/good/day.md',
  ]) {
    await readFile(path.join(outDir, f));
  }
  await readFile(path.join(dir, 'out', 'trend.csv'));
});

test('a component that fails a blocking gate is not ranked, however well it does elsewhere', async () => {
  const { dir, config } = await suite([good, inventor], {
    scoring: { profiles: { default: { weights: { quality: 1 } } } },
  });
  const { results } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const rows = results.rankings.default;
  assert.equal(rows.find((r) => r.id === 'good').rank, 1);
  const bad = rows.find((r) => r.id === 'inventor');
  assert.equal(bad.eligible, false);
  assert.equal(bad.rank, null);
  assert.equal(results.components.find((c) => c.id === 'inventor').gates.G3.pass, false);
  assert.match(
    results.components.find((c) => c.id === 'inventor').gates.G3.detail,
    /Marcus|16:45|11:00/,
  );
});

test('a gate marked warn is shown but does not block the ranking', async () => {
  const { dir, config } = await suite([good, inventor], {
    gates: { G3: { title: 'Invents nothing', severity: 'warn' } },
  });
  const { results } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const bad = results.rankings.default.find((r) => r.id === 'inventor');
  assert.equal(bad.eligible, true);
  assert.ok(bad.rank != null, 'a warning is not a block');
  assert.equal(
    results.components.find((c) => c.id === 'inventor').gates.G3.pass,
    false,
    'but it is still reported',
  );
});

test('a component that errors on every question is ranked nowhere and says why', async () => {
  const { dir, config } = await suite([good, broken]);
  const { results } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const c = results.components.find((x) => x.id === 'broken');
  assert.equal(c.gates.responds.pass, false);
  assert.match(c.gates.responds.detail, /HTTP 500/);
  assert.equal(c.eligible, false);
});

test('a component that cannot start does not stop the others', async () => {
  const deadStart = {
    id: 'dead',
    adapter: 'mock',
    lifecycle: {
      start: { command: 'node', args: ['-e', 'console.error("no weights");process.exit(2)'] },
      health: { url: 'http://127.0.0.1:1/', timeoutMs: 3000 },
    },
  };
  const { dir, config } = await suite([deadStart, good]);
  const { results } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  assert.match(results.components.find((c) => c.id === 'dead').startError, /no weights/);
  assert.equal(results.rankings.default.find((r) => r.id === 'good').rank, 1);
});

test('--only runs just those components', async () => {
  const { dir, config } = await suite([good, inventor]);
  const { results } = await run(config, { out: path.join(dir, 'out'), only: ['good'], log: quiet });
  assert.deepEqual(
    results.components.map((c) => c.id),
    ['good'],
  );
});

test('changing a rule and re-scoring needs no new run', async () => {
  const { dir, config } = await suite([good, inventor], { gates: { G3: { severity: 'warn' } } });
  const { outDir } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const before = JSON.parse(await readFile(path.join(outDir, 'results.json'), 'utf8'));
  assert.equal(before.rankings.default.find((r) => r.id === 'inventor').eligible, true);
  const strict = await loadConfig(path.join(dir, 'bench.config.json'));
  strict.gates.G3.severity = 'block';
  const { results } = await score(strict, outDir, { log: quiet, rescore: true });
  assert.equal(results.rankings.default.find((r) => r.id === 'inventor').eligible, false);
  assert.notEqual(results.suite.scoringHash, before.suite.scoringHash);
  assert.equal(results.suite.inputsHash, before.suite.inputsHash);
});

test('re-scoring is refused when the scenarios have changed since the answers were produced', async () => {
  const { dir, config } = await suite([good]);
  const { outDir } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  await writeFile(
    path.join(dir, 'scenarios', 's.json'),
    JSON.stringify(scenarios.map((s) => ({ ...s, input: { prompt: 'a different question' } }))),
  );
  await assert.rejects(
    score(await loadConfig(path.join(dir, 'bench.config.json')), outDir, { log: quiet }),
    /scenarios have changed/,
  );
});

test('a run cannot be resumed on different scenarios, so every component sees the same questions', async () => {
  const { dir, config } = await suite([good]);
  const { outDir } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  await writeFile(path.join(dir, 'scenarios', 's.json'), JSON.stringify(scenarios.slice(0, 1)));
  await assert.rejects(
    run(await loadConfig(path.join(dir, 'bench.config.json')), { resume: outDir, log: quiet }),
    /cannot resume/,
  );
});

test('resuming keeps finished components and skips their questions', async () => {
  const { dir, config } = await suite([good, inventor]);
  const first = await run(config, { out: path.join(dir, 'out'), only: ['good'], log: quiet });
  const lines = [];
  const again = await run(config, { resume: first.outDir, log: (m) => lines.push(m) });
  assert.ok(lines.some((l) => /good: already finished/.test(l)));
  assert.deepEqual(again.results.components.map((c) => c.id).sort(), ['good', 'inventor']);
});

function gitRepo() {
  return tmp().then((repo) => {
    const g = (...args) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
        cwd: repo,
        stdio: 'pipe',
      });
    g('init', '-q');
    writeFileSync(path.join(repo, 'code.txt'), 'v1');
    g('add', '.');
    g('commit', '-q', '-m', 'one');
    return { repo, g };
  });
}

test('the code under test moving during a run marks the run invalid', async () => {
  const { repo } = await gitRepo();
  const { dir, file } = await writeSuite({
    config: {
      components: [{ id: 'mover', adapter: 'module', options: { path: 'mover.mjs', repo } }],
      revision: { git: repo },
    },
    scenarios,
    files: {
      'mover.mjs': `import { execFileSync } from 'node:child_process';let n=0;export default async (i,{options})=>{if(++n===3)execFileSync('git',['-c','user.name=t','-c','user.email=t@example.com','commit','--allow-empty','-q','-m','moved'],{cwd:options.repo});return 'Standup 09:30 Priya'}`,
    },
  });
  const { results } = await run(await loadConfig(file), { out: path.join(dir, 'out'), log: quiet });
  assert.match(results.env.invalid, /changed during the run/);
  assert.match(results.notes.join(' '), /INVALID RUN/);
  assert.match(
    await readFile(
      path.join(
        dir,
        'out',
        (await readdir(path.join(dir, 'out'))).find((n) => n !== 'trend.csv'),
        'report.md',
      ),
      'utf8',
    ),
    /INVALID RUN/,
  );
});

test('a stable checkout is valid, and an uncommitted edit is named in the report and refused when the suite asks for a clean tree', async () => {
  const { repo } = await gitRepo();
  const { dir, file } = await writeSuite({
    config: { components: [good], revision: { git: repo } },
    scenarios,
  });
  const clean = await run(await loadConfig(file), { out: path.join(dir, 'out'), log: quiet });
  assert.equal(clean.results.env.invalid, undefined);
  assert.equal(clean.results.env.revision.dirty, false);
  writeFileSync(path.join(repo, 'code.txt'), 'edited');
  const dirty = await run(await loadConfig(file), { out: path.join(dir, 'out2'), log: quiet });
  assert.equal(dirty.results.env.revision.dirty, true);
  assert.ok(dirty.results.env.revision.dirtyHash);
  const strict = await loadConfig(file);
  strict.revision = { git: repo, requireClean: true };
  await assert.rejects(
    run(strict, { out: path.join(dir, 'out3'), log: quiet }),
    /uncommitted changes/,
  );
});

test('preflight refuses a noisy machine unless forced', async () => {
  const { dir, config } = await suite([good]);
  config.preflight = { minFreeMemoryMb: 10 ** 9 };
  await assert.rejects(run(config, { out: path.join(dir, 'out'), log: quiet }), /memory is free/);
  const { results } = await run(config, { out: path.join(dir, 'out'), force: true, log: quiet });
  assert.match(results.notes.join(' '), /Started despite/);
});

test('file judging: requests out, judgements in, order-swapped disagreement becomes a tie', async () => {
  const { dir, config } = await suite(
    [
      good,
      {
        ...good,
        id: 'other',
        options: { answers: { day: 'Standup at 09:30.', empty: 'Nothing on.' } },
      },
    ],
    { scoring: { profiles: { default: { weights: { quality: 1, preference: 1 } } } } },
  );
  const first = await run(config, { out: path.join(dir, 'out'), judge: 'file', log: quiet });
  const requests = JSON.parse(
    await readFile(path.join(first.outDir, 'judge-requests.json'), 'utf8'),
  );
  assert.equal(Object.keys(requests).length, 4, 'two scenarios, one pair, both ways round');
  assert.match(Object.values(requests)[0].prompt, /ANSWER A/);
  assert.equal(first.results.judge.status, 'waiting');
  // A judge that always answers "A", whatever the order.
  const biased = Object.fromEntries(
    Object.keys(requests).map((id) => [id, '{"winner":"A","reason":"first"}']),
  );
  await writeFile(
    path.join(first.outDir, 'judgements.json'),
    JSON.stringify({ ...biased, _judge: 'test-judge-1' }),
  );
  const { results } = await score(config, first.outDir, {
    judge: 'file',
    log: quiet,
    rescore: true,
  });
  assert.equal(results.judge.judge, 'test-judge-1');
  assert.equal(results.judge.orderConsistency, 0);
  const prefs = results.rankings.default.map((r) => r.dimensions.preference);
  assert.ok(
    Math.abs(prefs[0] - prefs[1]) < 0.5,
    'a position-biased judge must leave the two models level',
  );
});

test('judgements without a named judge are refused, so scores are never mixed across judges', async () => {
  const { dir, config } = await suite([good, { ...good, id: 'other' }]);
  const first = await run(config, { out: path.join(dir, 'out'), log: quiet });
  await writeFile(path.join(first.outDir, 'judgements.json'), JSON.stringify({ x: 'y' }));
  await assert.rejects(score(config, first.outDir, { judge: 'file', log: quiet }), /_judge/);
});

test('human ratings join the ranking, and a repeated pair measures consistency', async () => {
  const better = { ...good, id: 'better' };
  const worse = {
    id: 'worse',
    adapter: 'mock',
    options: { answers: { day: 'Something vague.', empty: 'Meh.' } },
  };
  const { dir, config } = await suite([better, worse], {
    scoring: { profiles: { default: { weights: { preference: 1 } } } },
    humanEval: { consistencyRepeats: 1 },
  });
  const first = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const key = JSON.parse(await readFile(path.join(first.outDir, 'human-eval-key.json'), 'utf8'));
  const page = await readFile(path.join(first.outDir, 'human-eval.html'), 'utf8');
  assert.ok(
    !page.includes('"better"') && !page.includes('"worse"'),
    'the page must not say which component wrote which answer',
  );
  const ratings = Object.entries(key.pairs).map(([pairId, p]) => ({
    pairId,
    choice: p.a === 'better' ? 'A' : 'B',
  }));
  await writeFile(path.join(first.outDir, 'ratings.json'), JSON.stringify({ ratings }));
  const { results } = await score(config, first.outDir, { log: quiet });
  assert.equal(results.pairwise.bySource.human, ratings.length);
  assert.deepEqual(results.pairwise.humanConsistency, { pairs: 1, same: 1 });
  const r = results.rankings.default;
  assert.equal(r[0].id, 'better');
  assert.ok(r[0].dimensions.preference > r[1].dimensions.preference);
});

test('re-scoring keeps the human-eval pairs, so ratings already given stay valid', async () => {
  const { dir, config } = await suite([
    good,
    { ...good, id: 'other', options: { answers: { day: 'x', empty: 'y' } } },
  ]);
  const first = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const keyBefore = await readFile(path.join(first.outDir, 'human-eval-key.json'), 'utf8');
  await score(config, first.outDir, { log: quiet, rescore: true });
  assert.equal(await readFile(path.join(first.outDir, 'human-eval-key.json'), 'utf8'), keyBefore);
});

test('the second report says what changed since the first, and warns when the scenarios differ', async () => {
  const { dir, config } = await suite([good]);
  const outRoot = path.join(dir, 'out');
  await run(config, { out: outRoot, log: quiet });
  await new Promise((r) => setTimeout(r, 1100)); // run folders are named by start time to the second
  config.repeats = 3;
  config.seeds = [1, 2, 3];
  const second = await run({ ...config }, { out: outRoot, log: quiet, revision: 'rev-2' });
  const md = await readFile(path.join(second.outDir, 'report.md'), 'utf8');
  assert.match(md, /Compared with/);
  assert.match(md, /not comparable/);
});

test('a custom reporter module is called with the results', async () => {
  const { dir, file } = await writeSuite({
    config: { components: [good], reports: ['./reporter.mjs'] },
    scenarios,
    files: {
      'reporter.mjs': `import { writeFile } from 'node:fs/promises';import path from 'node:path';export default async ({ outDir, results }) => writeFile(path.join(outDir, 'mine.txt'), 'top: ' + results.rankings.default[0].id)`,
    },
  });
  const { outDir } = await run(await loadConfig(file), { out: path.join(dir, 'out'), log: quiet });
  assert.equal(await readFile(path.join(outDir, 'mine.txt'), 'utf8'), 'top: good');
});

test('a custom check module is available to scenarios', async () => {
  const sc = [{ id: 'q', input: { prompt: 'hi' }, checks: [{ type: 'shouty' }] }];
  const { dir, file } = await writeSuite({
    config: {
      components: [{ id: 'm', adapter: 'mock', options: { default: 'HELLO' } }],
      checks: { shouty: './shouty.mjs' },
    },
    scenarios: sc,
    files: {
      'shouty.mjs': `export default (ctx) => ({ pass: ctx.text === ctx.text.toUpperCase() })`,
    },
  });
  const { results } = await run(await loadConfig(file), { out: path.join(dir, 'out'), log: quiet });
  assert.equal(results.components[0].dimensions.quality, 100);
});

test('report.html is one self-contained page: results inside it, nothing fetched', async () => {
  const { dir, config } = await suite([good]);
  const { outDir } = await run(config, { out: path.join(dir, 'out'), log: quiet });
  const page = await readFile(path.join(outDir, 'report.html'), 'utf8');
  assert.match(page, /<script type="application\/json" id="embedded">/);
  assert.doesNotMatch(
    page,
    /<link[^>]+href="(?!data:)|<script[^>]+src=/,
    'a standalone report must not point at other files',
  );
  assert.match(page, /script-src 'unsafe-inline'/);
  const embedded = JSON.parse(
    /id="embedded">([\s\S]*?)<\/script>/.exec(page)[1].replace(/\\u003c/g, '<'),
  );
  assert.equal(embedded.rankings.default[0].id, 'good');
});

test('end to end with a started model server: its memory is measured, a memory gate blocks it, and it is stopped', async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = `import http from 'node:http';const ballast=Buffer.alloc(80*1024*1024,1);
http.createServer((req,res)=>{
  if(req.url==='/health'){res.end('ok');return}
  req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});
  for(const t of ['Standup at ','09:30 with Priya.'])res.write('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\\n\\n');
  res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:20,completion_tokens:6},timings:{predicted_per_second:9.5,prompt_per_second:80}})+'\\n\\n');res.end('data: [DONE]\\n\\n')})
}).listen(${port},'127.0.0.1')`;
  const component = (id, extra = {}) => ({
    id,
    adapter: 'openai-compatible',
    options: { baseUrl: `http://127.0.0.1:${port}/v1` },
    lifecycle: {
      start: { command: 'node', args: ['server.mjs'] },
      health: { url: `http://127.0.0.1:${port}/health` },
      sampleMs: 50,
      ...extra,
    },
  });
  const { dir, file } = await writeSuite({
    config: {
      components: [component('big')],
      gates: { memory: { title: 'Fits', metric: 'peakRssMb', max: 20 } },
      scoring: {
        measures: { peakRssMb: { dimension: 'memory', good: 20, bad: 60 } },
        profiles: { default: { weights: { quality: 1, speed: 1, memory: 1 } } },
      },
    },
    scenarios,
    files: { 'server.mjs': server },
  });
  const { results } = await run(await loadConfig(file), { out: path.join(dir, 'out'), log: quiet });
  const c = results.components[0];
  if (process.platform !== 'win32') {
    assert.ok(
      c.measures.peakRssMb >= 40,
      `peak memory should show the server's 80 MB ballast, got ${c.measures.peakRssMb}`,
    );
    assert.equal(c.gates.memory.pass, false);
    assert.equal(c.eligible, false);
    assert.ok(c.dimensions.memory < 50);
  }
  assert.equal(c.measures.decodeTokensPerSec, 9.5);
  assert.equal(c.dimensions.quality, 100);
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }),
    'the server must be stopped when the component is done',
  );
});
