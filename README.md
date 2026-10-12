# benchmarking-suite

Benchmark anything that answers questions (a model, a prompt, a service, a program) against
scenarios you write, and get the same readable report every time.

The suite knows nothing about what you are testing. You bring three things:

| You provide                                                                                  | In                                  |
| -------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Components**: the things to compare (a model server, an API, a script, your own code)      | `components` in `bench.config.json` |
| **Scenarios**: the questions to ask, and how to tell a good answer from a bad one            | `scenarios/*.json`                  |
| **Scoring and output**: which gates block, how dimensions are weighted, which files to write | `gates`, `scoring`, `reports`       |

It grew out of benchmarking small language models that run on modest hardware, and
[examples/local-models](examples/local-models) shows that kind of benchmark as a suite. Nothing in the
core is specific to language models.

## Quick start

Needs Node 20 or newer. There is nothing to install: the suite uses only what Node ships with.

```sh
node bin/bench.js init my-benchmark     # copies the minimal example
cd my-benchmark
node ../bin/bench.js validate           # checks the config and scenarios
node ../bin/bench.js run                # runs, scores, writes bench-results/<run>/report.md
node ../bin/bench.js serve              # shows every run in a browser
```

(`npm run bench -- <command>` is the same as `node bin/bench.js <command>`.)

With Docker:

```sh
docker build -t benchmarking-suite .
docker run --rm -v "$PWD/my-benchmark:/suite" -v "$PWD/results:/results" benchmarking-suite \
  run --config /suite/bench.config.json --out /results
docker run -d -p 8080:8080 -v "$PWD/results:/results:ro" benchmarking-suite   # the viewer
```

## How a run works

1. **Preflight.** Refuses to start if memory is short or a named program (a chat client, a browser) is
   running, so the measurements are not disturbed. `--force` overrides and the report says so.
2. **One component at a time**, in the same order, on the same scenarios, the same number of times with
   the same seeds. If a component needs starting (a model server), the suite starts it, waits for it,
   watches its memory, and stops it again.
3. **Checks** run on every answer. A check can feed a **dimension** (quality, tools, anything you name), a
   **gate**, or both.
4. **Gates come before scores.** A component that fails a blocking gate is listed but not ranked, however
   well it did elsewhere. A gate set to `warn` is shown without blocking.
5. **Scores** are combined per **profile** (weights you choose), with a rank band from resampling the
   scenarios: components whose bands overlap are not meaningfully different.
6. **Judging and human ratings come afterwards**, never during the run, so they cannot slow what is being
   measured. See [docs/judging.md](docs/judging.md).

Fairness is enforced, not hoped for: every component in a run sees the same inputs on the same revision of
the code under test. If that code changes mid-run the run is marked **invalid**; a run cannot be resumed on
changed scenarios; and re-scoring refuses answers that came from different inputs.

## What a run writes

```
bench-results/<start time>-<revision>-<machine>/
  report.md            the same sections in the same order every time
  report.html          the same report as one self-contained page
  results.json         everything, with a schema version
  scores.csv           one row per component and scenario
  components.csv       one row per component
  answers/<component>/<scenario>.md    every answer, verbatim, with what the checks said
  answers.jsonl        the same, machine readable (re-scoring reads this)
  env.json             revision, machine, hashes of the inputs and of the scoring rules
  human-eval.html      anonymous pairs to rate; drop the downloaded ratings.json back in
bench-results/trend.csv    one row per component per run, for history
```

The shape of the output is yours to change: pick, reorder or add reporters in the config
([docs/results.md](docs/results.md)).

## Commands

```
bench run [--config f] [--out dir] [--only a,b] [--resume dir] [--judge none|file|on] [--dry-run]
bench score <run folder> [--judge ...]    re-score stored answers after changing a rule or adding ratings
bench validate                            check everything without running
bench serve [--results dir] [--port n]    read-only viewer
bench build-site [--results dir] [--out dir]   static viewer for Vercel or any static host
bench init <folder>                       start a new suite
```

## Where it can run

| Where         | Runs benchmarks?                                       | Shows results? |
| ------------- | ------------------------------------------------------ | -------------- |
| Your computer | Yes                                                    | Yes            |
| Docker        | Yes: [docs/docker.md](docs/docker.md)                  | Yes            |
| Vercel        | **No**, only results: [docs/vercel.md](docs/vercel.md) | Yes            |

Vercel functions cannot host a local model or give stable timings, so a Vercel deployment is a viewer for
runs made elsewhere. Components that are hosted APIs could run in a function, but a full run outlasts
function time limits; see the docs for the options.

## Documentation

- [Concepts](docs/concepts.md): components, scenarios, checks, gates, dimensions, profiles
- [Components and adapters](docs/components.md): connecting what you want to test
- [Scenarios and checks](docs/scenarios-and-checks.md): writing scenarios, every built-in check, your own checks
- [Results and reports](docs/results.md): output files, `results.json`, custom reporters
- [Judging and human ratings](docs/judging.md): the optional judge, cost cap, rating page
- [Docker](docs/docker.md), [Vercel](docs/vercel.md)
- [Decisions](docs/adr/README.md)

## Development

```sh
npm install      # tooling only: Prettier, commitlint, Git hooks
npm test         # node --test, no dependencies
npm run check    # formatting and tests
```

Commits follow [Conventional Commits](CONTRIBUTING.md). See [AGENTS.md](AGENTS.md) for the rules agents follow.
