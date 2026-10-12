# 0003. Fairness rules, enforced rather than documented

- Status: Accepted
- Date: 2026-10-12

## Context

The benchmark this grew from produced results that had to be thrown away: a model run with an uncommitted edit,
other apps competing for memory, a run that mixed two commits. Each was found by a person noticing.
The standing rule is that every candidate in a run is evaluated against exactly the same code and inputs,
and that a changed rule can be applied to old answers without re-running.

## Decision

- A run records the **revision** of the code under test (git commit plus a hash of any uncommitted change, or
  a label for things not in git) and checks it again at the end. If it moved, the run is marked **invalid**
  in `env.json`, the report and the exit code.
- A run records two hashes. `inputsHash` (scenario inputs, repeats, seeds) must match to resume a run or
  re-score its answers. `scoringHash` (checks, weights, gates) may change; `bench score` re-applies it to the
  stored answers.
- **Preflight** refuses to start on low free memory or when named programs are running, unless forced.
- Components run one at a time, each with a throwaway warm-up, started and stopped by the suite.
- **Gates are separate from scores**, and a gate can warn without blocking.
- Judged scores are never compared across judges; the judge's version is mandatory and recorded.
- A pair is judged both ways round, and a disagreement is a tie.

## Consequences

- A benchmark cannot silently lie about what it measured, at the cost of refusing to continue sometimes.
- Adding a component later means a new full run, not an extra row in an old one.
- Re-scoring is cheap, so rule changes do not need hours of model time.
