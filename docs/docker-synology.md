# Docker, and the Synology DS1821+

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
  -e BENCH_MACHINE=synology-ds1821plus -e BENCH_REVISION=my-code-v3 \
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

## On the Synology DS1821+

What is known: the DS1821+ is x86-64, so the image is built for `linux/amd64` with no extra steps. It has
64 GB of memory here.

What is **not** verified: the exact CPU. Retailer listings and reviews say AMD Ryzen V1500B (4 cores, 2.2 GHz); you recall a V1700.
Synology's own page did not load for me, so check `cat /proc/cpuinfo` on the NAS. Container Manager is
installed per your confirmation; the DSM version is unknown.

Suggested setup:

1. Copy this repository to the NAS (`/volume1/docker/benchmarking-suite`), with `suite/` and `results/` beside the compose file.
2. Container Manager > Project > Create, point at that folder, and it reads `compose.yaml`. Or SSH in and use `docker compose`.
3. Run a benchmark with the `run` profile; leave `viewer` running. Open `http://<nas>:8080`.

How to use the NAS well, from the benchmark's own rules:

- **Quality and correctness: yes. Speed and memory: only against other NAS runs.** Timings depend on the
  exact chip, memory and what else the NAS is doing; a NAS result must never be compared with a result
  from another machine. Set `machine` (or `BENCH_MACHINE`) so each result says where it came from.
- Its steady, always-on nature suits long runs, extra repeats and screening new candidates before they go
  to the machine that decides.
- Give the benchmark a cap so DSM and your other containers stay responsive (`cpus`, `mem_limit` in the compose
  file), and use `preflight` to refuse to start when memory is short.
- Large models on a CPU with no GPU are slow. The suite measures that honestly rather than hiding it, but plan runs
  that take hours.
