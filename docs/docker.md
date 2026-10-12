# Docker

One image does both jobs: it runs benchmarks (`run`, `score`) and shows results (`serve`, the default).

> **Status: the Dockerfile and compose file have not been built or run yet.** They were written in an
> environment with no Docker daemon. The same commands were exercised directly with Node (the full test
> suite, and `serve` and `build-site` by hand), but the first `docker build` is still to be confirmed.

## Build and run

```sh
docker build -t benchmarking-suite .
```

The image has no dependencies to download: it is Node plus this repository. It runs as the unprivileged
`node` user. Mount your suite at `/suite` and a results folder at `/results`:

```sh
docker run --rm \
  -v "$PWD/suite:/suite:ro" -v "$PWD/results:/results" \
  -e BENCH_MACHINE=my-host -e BENCH_REVISION=my-code-v3 \
  benchmarking-suite run --config /suite/bench.config.json --out /results

docker run -d --name bench-viewer -p 8080:8080 -v "$PWD/results:/results:ro" benchmarking-suite
```

`compose.yaml` does the same: `docker compose up -d viewer`, and `docker compose run --rm bench run ...`.
Set `BENCH_VIEW_PASSWORD` to put a password on the viewer (any user name).

Things to know inside a container:

- **The code under test is usually not in the container.** There is no git inside, so pass a label with
  `--revision` or `BENCH_REVISION`, and change it when the code changes. Without one the report says
  changes during a run could not be detected.
- **Memory** of a started model server is read from `/proc`, so it works. Memory limits set on the
  container are recorded (`containerMemoryLimitMb`).
- **Keys** (`ANTHROPIC_API_KEY` and so on) go in `environment`, never in the suite files.
- **A model server** can be started inside the same container by a component's `lifecycle` if its binary
  is in the image, or run as a second container the component talks to over the compose network. The
  compose file has a commented example using llama.cpp's server image; pin the image and model yourself.
- **Architecture.** The image has no native code, so it builds for whatever platform you build on
  (`linux/amd64` or `linux/arm64`).

## Choosing where to run

Set `machine` (or `BENCH_MACHINE`) so every result says where it came from.

- **Quality and correctness can be measured anywhere. Speed and memory only mean something against other
  runs on the same machine.** Timings depend on the exact chip, memory and what else the host is doing;
  never compare a result with one from different hardware. `targetMachine` in the config makes the report
  flag runs from somewhere else.
- A steady, always-on host suits long runs, extra repeats and screening new candidates before they go to the
  machine that decides.
- Cap what a benchmark may use so the host's other work stays responsive (`cpus`, `mem_limit` in the compose
  file), and use `preflight` to refuse to start when memory is short.
- Large models on a CPU with no GPU are slow. The suite measures that honestly rather than hiding it, but plan
  runs that take hours.
