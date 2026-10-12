import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCheckRegistry } from './checks/index.js';
import { hashSuite, loadConfig, loadScenarios } from './config.js';
import { run, score } from './runner.js';
import { buildSite, createViewer } from './serve.js';
import { adapterNames } from './adapters/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `bench: benchmark any components against your own scenarios

Usage: bench <command> [options]

Commands
  run                 Run every enabled component against every scenario, then score and report
  score <folder>      Re-score a finished run from its stored answers (after changing a check,
                      a weight, a gate, or adding judgements.json / ratings.json)
  validate            Check the config and scenarios without running anything
  serve               Show finished runs in a browser (read-only)
  build-site          Write a static copy of the viewer and results, for Vercel or any static host
  init <folder>       Start a new suite from the minimal example

Common options
  --config <file>     Suite config (default: ./bench.config.json)

run
  --out <dir>         Where run folders go (default: <config folder>/bench-results)
  --only <id,id>      Only these components (the report says the run was partial)
  --resume <folder>   Continue a run that stopped; refused if scenarios or code changed
  --revision <label>  Name the code under test when it is not a git checkout (or set BENCH_REVISION)
  --judge <mode>      none (default) | file | on   (see docs/judging.md)
  --max-spend <usd>   Stop judging at this estimated cost (default 10)
  --dry-run           Show what would run and how many requests it needs
  --force             Start despite preflight problems or uncommitted changes

score
  --judge <mode>      As above; "file" reads judgements.json from the folder

serve
  --results <dir>     Run folders to show (default: <config folder>/bench-results)
  --port <n>          Default 8080     --host <addr>   Default 127.0.0.1 (0.0.0.0 in Docker)

build-site
  --results <dir>  --out <dir> (default: public)  --with-answers
`;

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const bool = ['force', 'dry-run', 'with-answers', 'help'].includes(k);
      opts[k] = bool ? true : (inline ?? argv[++i]);
      if (!bool && opts[k] === undefined) throw new Error(`--${k} needs a value`);
    } else opts._.push(a);
  }
  return opts;
}

export async function main(argv) {
  const opts = parse(argv);
  const [command, arg] = opts._;
  if (!command || opts.help || command === 'help') return void console.log(HELP);
  const configFile = opts.config ?? 'bench.config.json';

  if (command === 'init') {
    const dest = path.resolve(arg ?? 'my-benchmark');
    if ((await readdir(dest).catch(() => [])).length) throw new Error(`${dest} is not empty`);
    await mkdir(dest, { recursive: true });
    await cp(path.join(ROOT, 'examples', 'minimal'), dest, { recursive: true });
    console.log(
      `Created ${dest}\nNext: cd ${arg ?? 'my-benchmark'} && node ${path.join(ROOT, 'bin/bench.js')} run`,
    );
    return;
  }

  if (command === 'validate') {
    const config = await loadConfig(configFile);
    const registry = await loadCheckRegistry(config);
    const scenarios = await loadScenarios(config, registry);
    const hashes = hashSuite(config, scenarios);
    const enabled = config.components.filter((c) => c.enabled !== false);
    console.log(`Config OK: ${config.name}`);
    console.log(
      `  components: ${enabled.length} enabled of ${config.components.length} (${enabled.map((c) => c.id).join(', ')})`,
    );
    console.log(
      `  scenarios:  ${scenarios.length} in ${new Set(scenarios.map((s) => s.group)).size} group(s)`,
    );
    console.log(
      `  checks:     ${scenarios.reduce((n, s) => n + (s.checks?.length ?? 0), 0)} (types: ${Object.keys(registry).join(', ')})`,
    );
    console.log(`  adapters:   ${adapterNames.join(', ')}`);
    console.log(`  hashes:     inputs ${hashes.inputsHash}, scoring ${hashes.scoringHash}`);
    const noChecks = scenarios.filter((s) => !s.checks?.length).map((s) => s.id);
    if (noChecks.length)
      console.log(
        `  note: no checks on ${noChecks.join(', ')} (they only count towards speed and judging)`,
      );
    return;
  }

  if (command === 'run') {
    const config = await loadConfig(configFile);
    if (opts['dry-run']) {
      const registry = await loadCheckRegistry(config);
      const scenarios = await loadScenarios(config, registry);
      const comps = config.components.filter(
        (c) => c.enabled !== false && (!opts.only || opts.only.split(',').includes(c.id)),
      );
      const calls = comps.length * scenarios.reduce((n, s) => n + (s.repeats ?? config.repeats), 0);
      console.log(
        `Would run ${comps.length} component(s) x ${scenarios.length} scenario(s) x ${config.repeats} repeat(s) = ${calls} answers (plus one warm-up each).`,
      );
      const pairs = (comps.length * (comps.length - 1)) / 2;
      console.log(
        `A judge would need up to ${pairs * scenarios.length * 2} requests (every pair, both ways round).`,
      );
      return;
    }
    const { outDir, results } = await run(config, {
      out: opts.out ? path.resolve(opts.out) : undefined,
      only: opts.only?.split(','),
      resume: opts.resume,
      revision: opts.revision,
      judge: opts.judge,
      maxSpend: opts['max-spend'] ? Number(opts['max-spend']) : undefined,
      force: opts.force,
    });
    summarise(outDir, results);
    if (results.env.invalid) process.exitCode = 2;
    return;
  }

  if (command === 'score' || command === 'report') {
    if (!arg) throw new Error('usage: bench score <run folder>');
    const config = await loadConfig(configFile);
    const { outDir, results } = await score(config, path.resolve(arg), {
      judge: opts.judge,
      maxSpend: opts['max-spend'] ? Number(opts['max-spend']) : undefined,
      rescore: true,
    });
    summarise(outDir, results);
    return;
  }

  if (command === 'serve') {
    const resultsDir = path.resolve(
      opts.results ?? path.join(path.dirname(path.resolve(configFile)), 'bench-results'),
    );
    const port = Number(opts.port ?? process.env.PORT ?? 8080);
    const host = opts.host ?? process.env.HOST ?? '127.0.0.1';
    createViewer({ resultsDir }).listen(port, host, () =>
      console.log(`Showing ${resultsDir}\nhttp://${host}:${port}/`),
    );
    return;
  }

  if (command === 'build-site') {
    const resultsDir = path.resolve(opts.results ?? 'bench-results');
    const runs = await buildSite({
      resultsDir,
      outDir: path.resolve(opts.out ?? 'public'),
      withAnswers: opts['with-answers'],
    });
    console.log(`Wrote ${runs.length} run(s) to ${opts.out ?? 'public'}`);
    return;
  }

  throw new Error(`unknown command "${command}". Try: bench help`);
}

function summarise(outDir, results) {
  console.log(`\nResults: ${outDir}`);
  for (const [profile, rows] of Object.entries(results.rankings)) {
    console.log(`\nProfile ${profile}`);
    for (const r of rows) {
      const gates = Object.entries(results.components.find((c) => c.id === r.id).gates)
        .filter(([, g]) => !g.pass)
        .map(([id]) => id);
      console.log(
        `  ${r.rank ?? ' -'}  ${r.id.padEnd(24)} ${String(r.score ?? 'n/a').padStart(5)}${r.band && r.band[0] !== r.band[1] ? `  (band ${r.band[0]}-${r.band[1]})` : ''}${gates.length ? `  gates failed: ${gates.join(', ')}` : ''}`,
      );
    }
  }
  for (const n of results.notes) console.log(`\n${n}`);
  console.log(`\nOpen ${path.join(outDir, 'report.md')}`);
}
