import { headers, httpError, inactivityController, parseAnswer } from './common.js';

/**
 * Any HTTP endpoint that takes a question and returns an answer: your own service, a
 * serverless function, another team's API. Posts { input, seed } as JSON.
 * options: url, method, headers (values may use ${ENV_VAR}), textPath ("choices.0.text" style
 * is not supported; use a dotted path such as "result.answer"), timeoutMs
 */
export function create({ options = {} }) {
  if (!options.url) throw new Error('the http adapter needs options.url');
  return {
    async run(input, { seed }) {
      const guard = inactivityController(options.timeoutMs ?? 300_000);
      const started = performance.now();
      try {
        const res = await fetch(options.url, {
          method: options.method ?? 'POST',
          headers: headers(options),
          body: JSON.stringify({ input, seed }),
          signal: guard.signal,
        });
        if (!res.ok) throw await httpError(res);
        const answer = parseAnswer(await res.text(), options.textPath);
        answer.metrics = { totalMs: Math.round(performance.now() - started), ...answer.metrics };
        return answer;
      } finally {
        guard.done();
      }
    },
  };
}
