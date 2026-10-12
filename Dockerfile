# Benchmarking suite. One image for running benchmarks and for viewing results.
#   docker build -t benchmarking-suite .
#   docker run --rm -v ./my-suite:/suite -v ./results:/results benchmarking-suite run --config /suite/bench.config.json --out /results
#   docker run -d -p 8080:8080 -v ./results:/results benchmarking-suite          (viewer)
FROM node:22-slim

ENV NODE_ENV=production \
    BENCH_IN_DOCKER=1 \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app
# No dependencies to install: the suite uses only what Node ships with.
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY site ./site
COPY examples ./examples

# Suites are mounted at /suite, finished runs are written to /results.
RUN mkdir -p /suite /results && chown node:node /suite /results
VOLUME ["/suite", "/results"]
WORKDIR /suite
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["node", "/app/bin/bench.js"]
CMD ["serve", "--results", "/results"]
