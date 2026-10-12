# Components and adapters

A component is an `id`, an `adapter`, adapter `options`, and optionally a `lifecycle`.

```json
{
  "id": "qwen3-1.7b",
  "name": "Qwen3 1.7B",
  "adapter": "openai-compatible",
  "options": { "baseUrl": "http://127.0.0.1:11436/v1", "temperature": 0.2, "maxTokens": 600 },
  "lifecycle": {
    "start": {
      "command": "llama-server",
      "args": ["-m", "${MODELS_DIR}/model.gguf", "--port", "11436"]
    },
    "health": { "url": "http://127.0.0.1:11436/health", "timeoutMs": 180000 },
    "cooldownMs": 60000
  },
  "profiles": ["light"],
  "tags": ["local"],
  "enabled": true
}
```

`enabled: false` keeps a component in the file without running it. `${NAME}` in `command` and `args` is
replaced from the environment.

## Adapters

An adapter takes the scenario's `input` and a `seed`, and returns `{ text, toolCalls?, metrics? }`.
`metrics` are numbers about this one answer: `firstTokenMs`, `totalMs`, `promptTokens`,
`completionTokens`, `decodeTokensPerSec`, `prefillTokensPerSec`, or anything you add.

| Adapter             | Use it for                                                                  | Notes                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-compatible` | llama.cpp `llama-server`, Ollama, vLLM, LM Studio, OpenAI and most gateways | Streams, so time to first word is real. Input: `messages` (or `prompt`), optional `tools`. Reads llama-server's own speed figures when present. Gives up on silence (`inactivityMs`, default 120 s), not on a long answer. |
| `anthropic`         | Claude models through the Messages API                                      | Not streamed: total time only. Needs `ANTHROPIC_API_KEY` (or `apiKeyEnv`).                                                                                                                                                 |
| `command`           | Any program or script, a container (`docker run -i ...`), a shell pipeline  | Sends `{ input, seed }` as JSON on stdin (`"stdin": "text"` sends just the prompt). Reads plain text or JSON `{ text, toolCalls?, metrics? }` from stdout. Non-zero exit is an error quoting stderr.                       |
| `http`              | Your own service or function                                                | POSTs `{ input, seed }`; `textPath` picks the answer out of the JSON (`"result.answer"`).                                                                                                                                  |
| `module`            | Your own JavaScript: an SDK, a library, a pipeline                          | `options.path` exports `async (input, { seed, options }) => string \| { text, ... }`.                                                                                                                                      |
| `mock`              | Trying a suite out, tests, smoke tests                                      | Canned answers per scenario id.                                                                                                                                                                                            |

Keys and tokens never go in the config: use `apiKeyEnv`, or `${ENV_VAR}` in header values. Anything in
`options` whose name looks like a credential is blanked in the saved results.

## Lifecycle

With a `start` command, the suite spawns the process, waits for the `health` URL, then watches the memory
of that process and everything it started (read from `/proc` on Linux, `ps` on macOS; not available on
Windows). It records load time, memory after load, peak and steady memory, and pages swapped in during the
run. When the component is done the process is stopped (polite stop, then kill after `stopTimeoutMs`) and
the run says so if anything is left behind. A process that dies on the way up is reported with its last
twenty lines of output rather than a guess.

Without `start`, the component is assumed to be running already. To watch the memory of something
you started yourself, use `"monitor": { "match": "llama-server" }`.

Only one component runs at a time, and each gets a throwaway warm-up question first (`"warmup": false`
to skip), so the first scored answer is not paying for a cold start. `warmupMs` is recorded.

## Adding your own adapter

Add a file in `src/adapters/` exporting `create({ options, baseDir, component })` that returns
`{ run(input, { seed, scenarioId }) }`, and register it in `src/adapters/index.js`. For a one-off, the
`module` adapter needs no change to the suite.
