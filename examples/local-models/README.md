# Example: local models behind an application harness

A benchmark for small language models that run on a modest machine, written as a suite. It is an example
to copy from, not part of the tool: every number here (weights, limits, models) is illustrative, and the
scenarios are small synthetic stand-ins for the situations such an application meets.

What it shows:

- **Components that need starting.** Each model is a `llama-server` the suite starts, waits for,
  watches the memory of, and stops again (`lifecycle`). `MODELS_DIR` is read from the environment.
- **Gates before scores.** `G2` (fits in memory, no swapping), `G4` (no circling) and `G5` (valid tool
  calls) block a model from being ranked. `G3` (invents nothing) blocks too, because an assistant is only
  useful if what it presents can be relied on. A gate can be set to `severity: "warn"` to report without blocking.
- **Two profiles.** `light` (small machine) and `standard` weigh the same dimensions differently.
  A component lists the profiles it competes in.
- **A judge.** `judge` runs a command-line tool from an empty folder (`judge-workdir/`, create it) so it does
  not pick up project instructions. Only used with `--judge on`. `my-judge-cli` is a placeholder.
- **Code under test.** `revision.git` points at the application's checkout (a placeholder path); the run
  refuses to start if it has uncommitted changes and marks itself invalid if the commit moves mid-run.

Try it without a model: `node ../../bin/bench.js validate`.

Not verified: the llama-server flags and the `chat_template_kwargs` setting for turning thinking off are
illustrative. Check them against the llama.cpp build you use. The judge command and the model file names are
likewise placeholders.
