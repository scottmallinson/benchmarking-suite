# Vercel

**What this deployment is: a viewer for results.** It does not run benchmarks. A Vercel function cannot
host a local model, has no stable hardware to time against, and has a time limit shorter than a real run, so
running here would produce numbers that mean nothing.

## Publish results

```sh
cp -r bench-results/<run folder> results/      # whichever runs you want public
git add results && git commit && git push      # Vercel builds on push
```

`vercel.json` runs `node bin/bench.js build-site --results results --out public` and serves `public/`.
There is nothing to install. The site is the same viewer as `bench serve`: ranking tables, gates, speed and
memory, results by group and scenario, and a quality-against-speed chart.

What is published per run: `results.json`, `report.md`, `report.html`, `scores.csv`, `components.csv`.
**Answers and `env.json` are not published** unless you build with `--with-answers`. Check what a run
contains before publishing it: component names, scenario titles and machine details are in `results.json`.

The site sets a strict Content-Security-Policy (everything from its own origin, no inline script),
`Referrer-Policy: no-referrer`, and fetches nothing from anywhere else. The viewer draws everything with
`textContent`, so model output in a result cannot run as markup.

The site has **no password**. For a private view, serve the results with Docker (`BENCH_VIEW_PASSWORD`) or use
Vercel's deployment protection.

## Human ratings on a deployed site

The rating page (`human-eval.html`) is not published: it is a file in a run folder, opened locally. It needs no
server, and ratings come back as a file. Nothing needs to be stored on Vercel.

## Running API-hosted components from a function: not done

Components that are hosted APIs could in principle be run from a function, but a full run (many scenarios,
repeats, several components, a judge) takes far longer than a function may run, and the results folder needs
somewhere to live. Two workable routes, neither built:

- A scheduled GitHub Actions workflow runs the benchmark for API components, commits the run to `results/`,
  and Vercel redeploys.
- A queue plus a worker outside Vercel. This is more to keep running.
