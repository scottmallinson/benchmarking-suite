import { expandEnv } from '../util.js';

/** Last user message as plain text, for adapters that take a single prompt. */
export function promptText(input) {
  if (typeof input === 'string') return input;
  if (input?.prompt) return input.prompt;
  const msgs = input?.messages ?? [];
  const last = [...msgs].reverse().find((m) => m.role === 'user') ?? msgs.at(-1);
  return last
    ? typeof last.content === 'string'
      ? last.content
      : JSON.stringify(last.content)
    : JSON.stringify(input);
}

export function chatMessages(input) {
  if (input?.messages) return input.messages;
  return [{ role: 'user', content: promptText(input) }];
}

/** Read the answer from whatever an adapter got back: plain text, or JSON with a text field. */
export function parseAnswer(raw, textPath) {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      const text = textPath ? textPath.split('.').reduce((o, k) => o?.[k], obj) : obj.text;
      if (typeof text === 'string') {
        return { text, toolCalls: obj.toolCalls ?? [], metrics: obj.metrics ?? {} };
      }
    } catch {
      /* not JSON after all: fall through and treat it as text */
    }
  }
  return { text: String(raw), toolCalls: [], metrics: {} };
}

export function headers(options, extra = {}) {
  const out = { 'content-type': 'application/json', ...extra };
  for (const [k, v] of Object.entries(options.headers ?? {})) out[k] = expandEnv(v);
  return out;
}

/** fetch with an inactivity timeout: it fires only when nothing has arrived for `ms`, not on total time. */
export function inactivityController(ms) {
  const controller = new AbortController();
  let timer;
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`no data for ${Math.round(ms / 1000)} s`)),
      ms,
    );
  };
  poke();
  return { signal: controller.signal, poke, done: () => clearTimeout(timer) };
}

export async function httpError(res) {
  const body = (await res.text().catch(() => '')).slice(0, 300);
  return new Error(`HTTP ${res.status}${body ? `: ${body}` : ''}`);
}
