/**
 * Built-in checks. Each takes (ctx, options) and returns { pass, score?, detail? }.
 *   ctx.text       the model's answer as text
 *   ctx.toolCalls  [{ name, arguments }] the answer asked for
 *   ctx.metrics    timings and token counts for this one run
 *   ctx.source     the material the answer was meant to be based on
 *   ctx.scenario   the whole scenario
 * A check that can be partly right returns a score between 0 and 1; otherwise the score is 0 or 1.
 */

const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function contains(ctx, o) {
  const values = list(o.values ?? o.value);
  const text = o.caseSensitive ? ctx.text : ctx.text.toLowerCase();
  const found = values.filter((v) => text.includes(o.caseSensitive ? v : String(v).toLowerCase()));
  const any = o.mode === 'any';
  const pass = any ? found.length > 0 || values.length === 0 : found.length === values.length;
  return {
    pass,
    score: values.length === 0 ? 1 : any ? (pass ? 1 : 0) : found.length / values.length,
    detail: pass ? undefined : `missing: ${values.filter((v) => !found.includes(v)).join(', ')}`,
  };
}

function notContains(ctx, o) {
  const values = list(o.values ?? o.value);
  const text = o.caseSensitive ? ctx.text : ctx.text.toLowerCase();
  const hit = values.filter((v) => text.includes(o.caseSensitive ? v : String(v).toLowerCase()));
  return { pass: hit.length === 0, detail: hit.length ? `found: ${hit.join(', ')}` : undefined };
}

function regex(ctx, o) {
  const matched = new RegExp(o.pattern, o.flags ?? 'i').test(ctx.text);
  const expect = o.expect ?? true;
  return {
    pass: matched === expect,
    detail: matched === expect ? undefined : `pattern ${matched ? 'matched' : 'did not match'}`,
  };
}

function length(ctx, o) {
  const t = ctx.text;
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  const lines = t.split('\n').filter((l) => l.trim()).length;
  const bullets = (t.match(/^\s*(?:[-*•]|\d+[.)])\s+/gm) ?? []).length;
  const problems = [];
  if (o.maxChars != null && t.length > o.maxChars)
    problems.push(`${t.length} characters (max ${o.maxChars})`);
  if (o.minChars != null && t.length < o.minChars)
    problems.push(`${t.length} characters (min ${o.minChars})`);
  if (o.maxWords != null && words > o.maxWords) problems.push(`${words} words (max ${o.maxWords})`);
  if (o.minWords != null && words < o.minWords) problems.push(`${words} words (min ${o.minWords})`);
  if (o.maxLines != null && lines > o.maxLines) problems.push(`${lines} lines (max ${o.maxLines})`);
  if (o.maxBullets != null && bullets > o.maxBullets)
    problems.push(`${bullets} bullets (max ${o.maxBullets})`);
  return { pass: problems.length === 0, detail: problems.join('; ') || undefined };
}

function jsonValid(ctx, o) {
  const body = ctx.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return { pass: false, detail: `not JSON: ${e.message}` };
  }
  const missing = list(o.requiredKeys).filter(
    (k) => !(parsed && typeof parsed === 'object' && k in parsed),
  );
  return {
    pass: missing.length === 0,
    detail: missing.length ? `missing keys: ${missing.join(', ')}` : undefined,
  };
}

/** Circling: the same line more than maxRepeats times, or the same run of words three times. */
function noRepeat(ctx, o) {
  const maxRepeats = o.maxRepeats ?? 1;
  const lines = new Map();
  for (const raw of ctx.text.split('\n')) {
    const line = norm(raw);
    if (line.length >= (o.minLineLength ?? 8)) lines.set(line, (lines.get(line) ?? 0) + 1);
  }
  const worstLine = [...lines].sort((a, b) => b[1] - a[1])[0];
  if (worstLine && worstLine[1] > maxRepeats) {
    return {
      pass: false,
      detail: `line repeated ${worstLine[1]} times: "${worstLine[0].slice(0, 60)}"`,
    };
  }
  const words = ctx.text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const n = o.ngram ?? 8;
  const grams = new Map();
  for (let i = 0; i + n <= words.length; i++) {
    const g = words.slice(i, i + n).join(' ');
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  const worstGram = [...grams].sort((a, b) => b[1] - a[1])[0];
  if (worstGram && worstGram[1] >= (o.maxNgramRepeats ?? 3)) {
    return { pass: false, detail: `${n}-word phrase repeated ${worstGram[1]} times` };
  }
  return { pass: true };
}

const TIME = /\b(\d{1,2}):(\d{2})\b/g;
const IGNORED_NAMES = new Set(
  'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december i today tomorrow yesterday this next last the a an'.split(
    ' ',
  ),
);

/**
 * Entities in the answer that are not in the source material. A heuristic, and meant to be:
 * it finds times, capitalised names and (opt-in) bare numbers. It is cheap, repeatable and
 * catches the invented meeting; it will not catch an invented sentence. Use a judge for that.
 */
function noInvented(ctx, o) {
  const kinds = o.kinds ?? ['time', 'name'];
  const source = `${ctx.source ?? ''} ${list(o.allowed).join(' ')}`;
  const sourceLower = source.toLowerCase();
  const sourceTimes = new Set([...source.matchAll(TIME)].map((m) => `${Number(m[1])}:${m[2]}`));
  const ignored = new Set([
    ...IGNORED_NAMES,
    ...list(o.ignore).map((s) => String(s).toLowerCase()),
  ]);
  const invented = [];

  if (kinds.includes('time')) {
    for (const m of ctx.text.matchAll(TIME)) {
      if (!sourceTimes.has(`${Number(m[1])}:${m[2]}`)) invented.push(m[0]);
    }
  }
  if (kinds.includes('name')) {
    for (const m of ctx.text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g)) {
      const before = ctx.text.slice(0, m.index).replace(/[\s*_>#-]+$/, '');
      const sentenceStart =
        before === '' ||
        /[.!?:\n]$/.test(before) ||
        /\n\s*(?:[-*•]|\d+[.)])?\s*$/.test(ctx.text.slice(0, m.index));
      const words = m[0].split(/\s+/);
      if (sentenceStart && words.length === 1) continue;
      const kept = words.filter((w) => !ignored.has(w.toLowerCase()));
      if (
        kept.length &&
        !sourceLower.includes(kept.join(' ').toLowerCase()) &&
        !kept.every((w) => sourceLower.includes(w.toLowerCase()))
      ) {
        invented.push(m[0]);
      }
    }
  }
  if (kinds.includes('number')) {
    const withoutTimes = ctx.text.replace(TIME, ' ');
    const sourceNumbers = new Set(source.replace(TIME, ' ').match(/\b\d+(?:\.\d+)?\b/g) ?? []);
    for (const m of withoutTimes.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      if (!sourceNumbers.has(m[0])) invented.push(m[0]);
    }
  }
  for (const f of list(o.forbidden)) {
    if (ctx.text.toLowerCase().includes(String(f).toLowerCase())) invented.push(f);
  }
  const unique = [...new Set(invented)];
  return {
    pass: unique.length === 0,
    detail: unique.length ? `not in the source: ${unique.join(', ')}` : undefined,
  };
}

/** The listed phrases that appear must appear in this order. */
function order(ctx, o) {
  const text = ctx.text.toLowerCase();
  const positions = list(o.values)
    .map((v) => ({ v, at: text.indexOf(String(v).toLowerCase()) }))
    .filter((p) => p.at >= 0);
  if (o.requireAll && positions.length !== list(o.values).length) {
    return { pass: false, detail: 'some phrases are missing' };
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].at < positions[i - 1].at) {
      return { pass: false, detail: `"${positions[i].v}" comes before "${positions[i - 1].v}"` };
    }
  }
  return { pass: true };
}

/** Compare the call the model made to the call that was expected, the way function-calling leaderboards do. */
function toolCall(ctx, o) {
  const calls = ctx.toolCalls ?? [];
  if (o.expectNone)
    return {
      pass: calls.length === 0,
      detail: calls.length ? `called ${calls.map((c) => c.name).join(', ')}` : undefined,
    };
  const call = calls.find((c) => c.name === o.tool);
  if (!call) return { pass: false, score: 0, detail: `no call to ${o.tool}` };
  const checks = Object.entries(o.arguments ?? {});
  const bad = [];
  for (const [key, want] of checks) {
    const got = call.arguments?.[key];
    const ok =
      want && typeof want === 'object' && 'oneOf' in want
        ? want.oneOf.includes(got)
        : want && typeof want === 'object' && 'regex' in want
          ? new RegExp(want.regex).test(String(got))
          : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${key}=${JSON.stringify(got)}`);
  }
  if (call.argumentsValid === false) bad.push('arguments were not valid JSON');
  const total = checks.length + 1;
  return {
    pass: bad.length === 0,
    score: (total - bad.length) / total,
    detail: bad.length ? `wrong arguments: ${bad.join(', ')}` : undefined,
  };
}

/** A limit on something measured for this one run, such as firstTokenMs or completionTokens. */
function metric(ctx, o) {
  const v = ctx.metrics?.[o.metric];
  if (v == null) return { pass: false, detail: `${o.metric} was not measured` };
  const tooHigh = o.max != null && v > o.max;
  const tooLow = o.min != null && v < o.min;
  return {
    pass: !tooHigh && !tooLow,
    detail: tooHigh || tooLow ? `${o.metric} = ${v}` : undefined,
  };
}

export const builtin = {
  contains,
  'not-contains': notContains,
  regex,
  length,
  'json-valid': jsonValid,
  'no-repeat': noRepeat,
  'no-invented': noInvented,
  order,
  'tool-call': toolCall,
  metric,
};
