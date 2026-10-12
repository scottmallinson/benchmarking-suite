import { sleep } from '../util.js';

/**
 * Canned answers, for trying a suite out, for tests, and for the Docker smoke test.
 * options: answers { scenarioId: "text" | { text, toolCalls } }, default, latencyMs, failOn [scenarioId]
 * An answer may be an array: repeat n gets answers[n % length], to simulate a model that varies.
 */
export function create({ options = {} }) {
  let calls = new Map();
  return {
    async run(input, { scenarioId }) {
      if (options.latencyMs) await sleep(options.latencyMs);
      if ((options.failOn ?? []).includes(scenarioId)) throw new Error('HTTP 500: mock failure');
      const n = calls.get(scenarioId) ?? 0;
      calls.set(scenarioId, n + 1);
      let answer = options.answers?.[scenarioId] ?? options.default ?? '';
      if (Array.isArray(answer)) answer = answer[n % answer.length];
      const a = typeof answer === 'string' ? { text: answer } : answer;
      return {
        text: a.text ?? '',
        toolCalls: a.toolCalls ?? [],
        metrics: {
          firstTokenMs: options.latencyMs ?? 1,
          totalMs: options.latencyMs ?? 1,
          ...a.metrics,
        },
      };
    },
  };
}
