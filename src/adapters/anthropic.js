import { chatMessages, headers, httpError, inactivityController } from './common.js';

/**
 * Claude models through the Messages API. Not streamed, so there is no time to first word,
 * only total time. options: model, apiKeyEnv (default ANTHROPIC_API_KEY), maxTokens,
 * temperature, baseUrl, version
 */
export function create({ options = {} }) {
  const keyName = options.apiKeyEnv ?? 'ANTHROPIC_API_KEY';
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`environment variable ${keyName} is not set`);
  const baseUrl = String(options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');

  return {
    async run(input) {
      const all = chatMessages(input);
      const system = all
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const body = {
        model: options.model,
        max_tokens: input.maxTokens ?? options.maxTokens ?? 1024,
        temperature: input.temperature ?? options.temperature ?? 0,
        messages: all.filter((m) => m.role !== 'system'),
        ...(system ? { system } : {}),
        ...options.extraBody,
      };
      const guard = inactivityController(options.timeoutMs ?? 120_000);
      const started = performance.now();
      try {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: headers(options, {
            'x-api-key': apiKey,
            'anthropic-version': options.version ?? '2023-06-01',
          }),
          body: JSON.stringify(body),
          signal: guard.signal,
        });
        if (!res.ok) throw await httpError(res);
        const json = await res.json();
        const text = (json.content ?? [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        const toolCalls = (json.content ?? [])
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ name: b.name, arguments: b.input, argumentsValid: true }));
        return {
          text,
          toolCalls,
          metrics: {
            totalMs: Math.round(performance.now() - started),
            promptTokens: json.usage?.input_tokens,
            completionTokens: json.usage?.output_tokens,
          },
        };
      } finally {
        guard.done();
      }
    },
  };
}
