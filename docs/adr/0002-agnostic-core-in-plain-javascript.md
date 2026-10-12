# 0002. An agnostic core in plain JavaScript with no dependencies

- Status: Accepted
- Date: 2026-10-12

## Context

The suite must benchmark things it knows nothing about, run in a small Docker image on a NAS, be deployable
as a static results viewer, and be easy to read and change by people who did not write it. The benchmark it grew
from (Chief's `bench/`) was plain Node ES modules with no test framework dependency.

## Decision

- The core is Node 20+ ES modules with **no runtime dependencies**, using `node:test`, `fetch`, `node:http`
  and `node:child_process`. No build step, no TypeScript compiler, no bundler.
- Everything specific to a subject lives behind three plug-in points that take a plain file: **adapters**
  (how to ask a component), **checks** (how to judge an answer) and **reporters** (what to write). The
  built-ins use the same interfaces as user code.
- Scenario `input` is opaque to the core and handed to the adapter untouched.
- Dimensions, gates, profiles and group names are strings the user chooses; the core has no built-in idea
  of "quality" beyond using it as the default dimension name.

## Consequences

- The Docker image has nothing to install and little to attack. Updating Node is the only upkeep.
- No types: shapes are documented in `docs/` and enforced by tests. If the code grows, JSDoc types checked by
  `tsc --noEmit` can be added without changing the runtime.
- Platform differences are handled by hand (memory sampling reads `/proc` on Linux and `ps` on macOS, and is
  not available on Windows).
