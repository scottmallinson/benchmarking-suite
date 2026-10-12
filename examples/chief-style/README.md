# Example: Chief-style benchmark

This is the shape of the benchmark that was run against [Chief](https://github.com/scottmallinson/chief.ai)
(an on-device chief-of-staff app), written as a suite for this repository. It is an example to copy
from, not part of the tool: every number here (weights, limits, models) is Chief's, and the
scenarios are small synthetic stand-ins for Chief's runbook fixtures.

What it shows:

- **Components that need starting.** Each model is a `llama-server` the suite starts, waits for,
  watches the memory of, and stops again (`lifecycle`). `MODELS_DIR` is read from the environment.
- **Gates before scores.** `G2` (fits in memory, no swapping), `G4` (no circling) and `G5` (valid tool
  calls) block a model from being ranked. `G3` (invents nothing) blocks too, because Chief only works if what it
  presents can be relied on. A gate can be set to `severity: "warn"` to report without blocking.
- **Two profiles.** `light` (8 GB machine) and `standard` weigh the same dimensions differently.
  A component lists the profiles it competes in.
- **A judge that costs nothing extra to try.** `judge` runs the installed `claude -p` from an empty folder
  (`judge-workdir/`, create it) so it does not pick up project instructions. Only used with `--judge on`.
- **Code under test.** `revision.git` points at the Chief checkout; the run refuses to start if it has
  uncommitted changes and marks itself invalid if the commit moves mid-run.

Try it without a model: `node ../../bin/bench.js validate`.

Not verified: the llama-server flags and the `chat_template_kwargs` setting for turning thinking off are
illustrative. Check them against the llama.cpp build you use. The judge command and the model file names are
likewise placeholders.
