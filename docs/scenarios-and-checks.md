# Scenarios and checks

Scenarios are `.json` (one object or an array), `.jsonl` (one per line) or `.mjs` (default-exporting an
object or array) under the folders or files listed in `scenarios`. Folders are searched recursively.
A large input can live in its own file named `something.input.json` and be pointed at with `inputFile`.

```json
{
  "id": "brief-busy-day",
  "group": "brief-busy",
  "title": "Five meetings and two reviews waiting",
  "input": { "messages": [{ "role": "user", "content": "..." }] },
  "notes": "Next meeting is Standup at 09:30.",
  "source": "optional: the material the answer must be based on (default: the input's messages)",
  "repeats": 5,
  "humanRate": true,
  "judge": true,
  "checks": [{ "type": "contains", "values": ["09:30"], "label": "leads with the next meeting" }]
}
```

- `input` is handed to the adapter untouched. For `openai-compatible` it is `messages` (and `tools`).
- `notes` are shown to a judge and to people rating answers, as the facts a good answer respects.
- `repeats` overrides the suite-wide count. `humanRate: true` always includes the scenario in the rating
  page; `false` excludes it. `judge: false` keeps it away from the judge.

## Every check

All checks accept `label` (the name shown in reports), `dimension` (default `quality`; `null` for none),
`gate` (a gate name), and `weight` (default 1). A gate with no `dimension` is gate-only.

| `type`         | Options                                                                                     | Passes when                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `contains`     | `values` or `value`, `mode: all\|any`, `caseSensitive`                                      | the phrases appear. Score is the share found.                                                         |
| `not-contains` | `values`                                                                                    | none appear                                                                                           |
| `regex`        | `pattern`, `flags`, `expect` (default true)                                                 | it matches (or not)                                                                                   |
| `length`       | `maxChars`, `minChars`, `maxWords`, `minWords`, `maxLines`, `maxBullets`                    | within limits                                                                                         |
| `json-valid`   | `requiredKeys`                                                                              | the answer parses as JSON (fences allowed) with those keys                                            |
| `no-repeat`    | `maxRepeats` (1), `minLineLength` (8), `ngram` (8), `maxNgramRepeats` (3)                   | no line repeats too often and no run of words repeats 3 times: circling                               |
| `no-invented`  | `kinds` (`time`, `name`, `number`; default time and name), `allowed`, `ignore`, `forbidden` | times, capitalised names and (opt-in) numbers in the answer all appear in the source                  |
| `order`        | `values`, `requireAll`                                                                      | the listed phrases that appear do so in that order                                                    |
| `tool-call`    | `tool`, `arguments` (`value`, `{"oneOf": []}` or `{"regex": ""}`), or `expectNone: true`    | the model called the tool with those arguments (or abstained). Score is the share of arguments right. |
| `metric`       | `metric`, `max`, `min`                                                                      | a measured value for this answer (for example `firstTokenMs`) is within limits                        |

`no-invented` is a heuristic and is meant to be: cheap and repeatable, it catches the made-up meeting or
person. It cannot catch an invented sentence; that is for a judge or a person.

## Your own checks

Register a module under `checks` in the config, then use its name as a `type`:

```json
{ "checks": { "polite": "./checks/polite.mjs" } }
```

```js
// checks/polite.mjs
export default function (ctx, options) {
  // ctx: { text, toolCalls, metrics, source, scenario }
  const pass = !/stupid/i.test(ctx.text);
  return { pass, score: pass ? 1 : 0, detail: pass ? undefined : 'rude' };
}
```

A check that throws counts as failed, with the message as its detail. An answer that errored fails every
check, so an outage can never look like a pass.
