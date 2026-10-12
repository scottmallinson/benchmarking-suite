# Concepts

**Component**: one thing under test. A model behind an API, a prompt, a service, a command-line program,
a function in your own code. Each has an `id`, an `adapter` that knows how to ask it a question, and
optionally a `lifecycle` (how to start and stop it) and `profiles` (which rankings it competes in).

**Scenario**: one question, with its checks. It has an `id`, a `group` (for the report), an `input`
(passed to the adapter untouched, so its shape is whatever your components expect), and `checks`.

**Check**: a small function that looks at one answer and says pass or fail, optionally with a partial
score. The suite ships common ones; you can add your own. A check has a **dimension** (what it counts
towards, default `quality`), a **gate** (a named pass/fail test the component must clear), or both. A check
with a gate and no dimension is gate-only.

**Dimension**: any name you like: `quality`, `tools`, `safety`, `tone`. Each is the average of its checks,
0 to 100. Measured things join as dimensions too: `speed` from time to first word, `memory` from peak memory,
each through a "good enough" curve (full marks at `good`, zero at `bad`, a straight line between).

**Gate**: a named test that blocks ranking. "Invents nothing", "fits in memory", "calls tools with valid
arguments". `minPassRate` sets how often it must hold (default always); `severity: "warn"` reports a
failure without blocking. A gate can also be a limit on something measured about the whole component
(`metric` and `max`/`min`). One gate is built in: `responds`, which fails a component that errors or
returns nothing.

**Profile**: a set of weights over dimensions. The same components can be ranked for a small machine and a
large one. Dimensions with no evidence are left out and the rest rescaled, and the report says which.

**Run**: one go at everything, on one revision of the code under test. A run folder is never edited to
add a component later; add it and run again, so everything is measured on the same code.

**Revision**: what version of the code under test this run measured. Taken from git (`revision.git`, a folder),
or a label you give (`--revision`, `BENCH_REVISION`, or `revision.label`) for things that are not in git.
An uncommitted change is recorded with a hash of the change.

**Two hashes.** `inputsHash` covers what was asked (scenario inputs, repeats, seeds): answers from different
inputs can never be compared or re-scored together. `scoringHash` covers how answers are judged (checks,
weights, gates): it may change later, and `bench score` re-applies it to the stored answers without a new
run. Both are in every report.

**Rank band**: the scenarios are resampled 1,000 times and each component's rank recomputed; the band is
the middle 95% of those ranks. Overlapping bands mean the data cannot separate two components.
