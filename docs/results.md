# Results and reports

Each run writes a folder (see the README). `results.json` has a `schemaVersion` (currently 1) and holds:

- `suite`: name, `inputsHash`, `scoringHash`, scenario count, repeats, seeds
- `env`: start and finish times, `revision` (label, sha, branch, dirty, dirtyHash), `machine` (label, cpu,
  cores, memory, container memory limit, OS, Node), `invalid` if the code moved mid-run
- `components[]`: `eligible`, `gates` (each with `pass`, `passRate`, `detail`), `dimensions`, `groups`,
  `measures` (load time, memory, medians of every metric), `scenarioRows`
- `rankings.<profile>[]`: `rank` (null if not eligible), `band`, `score`, `dimensions`, `leftOut`
- `scenarios[]`: per component pass rate, distinct answers, failing checks
- `pairwise`: judge and human comparison counts and agreement; `judge`: mode, version, cost
- `notes`: anything a reader should know (invalid run, forced start, incomplete judging)

Full answers are in `answers.jsonl` and `answers/`, not in `results.json`.

## Choosing the output

`reports` in the config is a list. Built in: `markdown`, `json` (always written), `csv`, `trend`,
`human-eval`, `html`. The Markdown report's sections are fixed in order so two reports can be compared by eye
and by diff; `report.sections` picks and orders them from `headline`, `changes`, `measures`, `groups`,
`fixtures`, `answers`, `judge`, `notes`.

A path starting with `.` or `/` is your own reporter:

```js
// reporters/slack.mjs
export default async function ({ config, outDir, results, records, scenarios, comparisons, log }) {
  // write whatever shape you want from results (and records, the raw answers)
}
```

## History

`trend.csv` sits beside the run folders and gets one row per component and profile for each run (replaced if
a run is re-scored). "What changed since the last run" compares with the latest earlier run on the same
machine label, and says when the scenarios or the judge differ, because then scores are not comparable.
Speed and memory are only comparable between runs on the same hardware: set `targetMachine` in the config
and the report flags any run from somewhere else.

## Re-scoring

`bench score <run folder>` re-applies the current checks, gates, weights and any `judgements.json` or
`ratings.json` to the stored answers, without running anything again. It refuses if the scenarios'
inputs have changed since the answers were produced.
