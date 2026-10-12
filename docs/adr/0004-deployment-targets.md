# 0004. Docker runs benchmarks; Vercel only shows results

- Status: Accepted
- Date: 2026-10-12

## Context

The suite is wanted as a Docker container (for a home server) and as a deployable service such as Vercel
"where feasible". Benchmarks of local models need a process that stays up for hours, a model server on the
same machine, and stable hardware for timings.

## Decision

- One Docker image runs benchmarks and serves the results viewer.
- Vercel hosts a static build of the viewer plus selected result summaries. It does not run benchmarks.
- Results are a folder of files, not a database, so any host can show them and a run can be moved by copying.
- Answers and environment details are not published by default.

## Consequences

- Nothing is needed on Vercel except a build command; there is no state to lose or secure there.
- Running API-hosted components remotely (a scheduled workflow, or a worker) is left as a later option.
