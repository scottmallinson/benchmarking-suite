import { chatMessages, headers, httpError, inactivityController } from './common.js';

/**
 * Anything that speaks the OpenAI chat completions API: llama.cpp's llama-server, Ollama, vLLM,
 * LM Studio, OpenAI, and most hosted gateways. Streams, so time to first word is measured.
 *
 * options: baseUrl (…/v1), model, apiKeyEnv, temperature, maxTokens, inactivityMs,
 *          stream (default true), extraBody, headers
 */
export function create({ options = {} }) {
  const baseUrl = String(options.baseUrl ?? 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
  const stream = options.stream !== false;
  const apiKey = options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined;
  if (options.apiKeyEnv && !apiKey)
    throw new Error(`environment variable ${options.apiKeyEnv} is not set`);

  return {
    async run(input, { seed }) {
      const body = {
        model: options.model,
        messages: chatMessages(input),
        temperature: input.temperature ?? options.temperature ?? 0,
        max_tokens: input.maxTokens ?? options.maxTokens,
        seed,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
        ...options.extraBody,
        ...input.extraBody,
      };
      const guard = inactivityController(options.inactivityMs ?? 120_000);
      const started = performance.now();
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: headers(options, apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          body: JSON.stringify(body),
          signal: guard.signal,
        });
        if (!res.ok) throw await httpError(res);
        return stream
          ? await readStream(res, started, guard)
          : readWhole(await res.json(), started);
      } finally {
        guard.done();
      }
    },
  };
}

function toolCallsFrom(map) {
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => {
      let args = {};
      let argumentsValid = true;
      try {
        args = c.arguments ? JSON.parse(c.arguments) : {};
      } catch {
        args = { __raw: c.arguments };
        argumentsValid = false;
      }
      return { name: c.name, arguments: args, argumentsValid };
    });
}

function metricsFrom({ usage, timings, started, firstAt, ended }) {
  const m = { totalMs: Math.round(ended - started) };
  if (firstAt != null) m.firstTokenMs = Math.round(firstAt - started);
  if (usage?.prompt_tokens != null) m.promptTokens = usage.prompt_tokens;
  if (usage?.completion_tokens != null) m.completionTokens = usage.completion_tokens;
  // llama-server reports its own timings, which exclude network and queueing.
  if (timings?.predicted_per_second) m.decodeTokensPerSec = timings.predicted_per_second;
  else if (m.completionTokens && firstAt != null && ended > firstAt)
    m.decodeTokensPerSec = m.completionTokens / ((ended - firstAt) / 1000);
  if (timings?.prompt_per_second) m.prefillTokensPerSec = timings.prompt_per_second;
  return m;
}

function readWhole(json, started) {
  const msg = json.choices?.[0]?.message ?? {};
  const calls = new Map(
    (msg.tool_calls ?? []).map((c, i) => [
      i,
      { name: c.function?.name, arguments: c.function?.arguments },
    ]),
  );
  const ended = performance.now();
  return {
    text: msg.content ?? '',
    toolCalls: toolCallsFrom(calls),
    metrics: metricsFrom({
      usage: json.usage,
      timings: json.timings,
      started,
      firstAt: null,
      ended,
    }),
  };
}

async function readStream(res, started, guard) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let firstAt = null;
  let usage;
  let timings;
  const calls = new Map();
  for await (const chunk of res.body) {
    guard.poke();
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error)
        throw new Error(`server error: ${json.error.message ?? JSON.stringify(json.error)}`);
      usage = json.usage ?? usage;
      timings = json.timings ?? timings;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        firstAt ??= performance.now();
        text += delta.content;
      }
      // A streamed tool call arrives in fragments: the name once, then the arguments in pieces.
      for (const part of delta.tool_calls ?? []) {
        firstAt ??= performance.now();
        const call = calls.get(part.index ?? 0) ?? { name: '', arguments: '' };
        if (part.function?.name) call.name = part.function.name;
        if (part.function?.arguments) call.arguments += part.function.arguments;
        calls.set(part.index ?? 0, call);
      }
    }
  }
  return {
    text,
    toolCalls: toolCallsFrom(calls),
    metrics: metricsFrom({ usage, timings, started, firstAt, ended: performance.now() }),
  };
}
