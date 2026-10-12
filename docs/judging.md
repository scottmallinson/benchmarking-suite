# Judging and human ratings

Code checks decide everything they can. Two optional steps cover what code cannot: an AI judge, and people.
Both work on **pairs of answers**, and both feed one ranking (Bradley-Terry, with resampled intervals) that
joins the score as the `preference` dimension.

Neither runs during the benchmark.

## The judge

`--judge none` (default): no judge. `--judge on`: call the judge in the config. `--judge file`: hand the work
to any outside tool.

Every pair is judged twice, once each way round. If the two verdicts disagree the pair is a **tie**, never a
win: that is what stops a judge that favours "answer A" from deciding the ranking. The report shows how often
the judge agreed with itself.

```json
"judge": {
  "adapter": "command",
  "version": "my-judge-2026-10",
  "maxSpend": 10,
  "pricing": { "inputPerMTok": 0.1, "outputPerMTok": 0.5 },
  "rubric": "Prefer the answer that is accurate, invents nothing and is most useful.",
  "options": { "command": "my-judge-cli", "args": ["--print"], "stdin": "text", "cwd": "judge-workdir" }
}
```

- The judge is any adapter. `version` is required and recorded: a judge update must never change scores
  unseen, and **judged scores are never comparable across judges** (the report says when they differ).
- **Spend cap.** With `pricing` set, judging stops at `maxSpend` dollars (`--max-spend`, default 10) and
  reports what it finished. Answers already judged are kept in `judgements.jsonl` and re-used next time.
- Judge with a **different model from any component**: a model judging its own answers is biased.
- Run the judge from an empty folder if it is a coding assistant, so project instructions are not loaded.
  Whether a subscription-backed command-line tool may be used this way is the provider's rule, not this
  suite's; check the terms before relying on it, and prefer an API key for any run that decides something.

### `--judge file`: a workflow tool, a notebook, anything

The suite writes `judge-requests.json`: `{ "<id>": { "prompt": "..." } }`. Your tool answers each and writes
`judgements.json` in the run folder:

```json
{ "<id>": "{\"winner\": \"A\", \"reason\": \"...\"}", "_judge": "my-judge-2026-09" }
```

then `bench score <run folder> --judge file`. `_judge` is required and names the judge and its version.

## Human ratings

`human-eval.html` in the run folder is one self-contained page. Open it in any browser: it shows the
situation and two anonymous answers in random order, you pick A, B or about the same, and it downloads
`ratings.json`. Drop that in the run folder and run `bench score`. Nothing leaves your machine, and you can
stop early: the report says how many pairs were rated.

Pairs are chosen by `humanEval`: scenarios marked `humanRate` or in `groups` first, then pairs the judge
found close or inconsistent, then neighbours in the ranking, up to `maxPairs` (default 50). A few pairs
repeat with the sides swapped (`consistencyRepeats`) to show how consistent the rater is. The pairs are fixed
the first time the page is made (`human-eval-key.json`), so ratings stay valid when a run is re-scored.

Where judge and human saw the same pair, the report gives how often they agreed. If that is low for a
criterion you care about, fix the rubric before trusting the judge: the human result wins.
