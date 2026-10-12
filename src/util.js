import { createHash } from 'node:crypto';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** JSON with sorted keys, so the same data always hashes the same. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Small seeded random numbers (mulberry32), so bootstraps and pair sampling repeat exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export const median = (xs) => percentile(xs, 0.5);

/** Copy of a config with anything that looks like a credential blanked out. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /key|token|secret|authorization|password/i.test(k) &&
        typeof v === 'string' &&
        !/Env$/.test(k)
          ? '[redacted]'
          : redact(v),
      ]),
    );
  }
  return value;
}

/** Replace ${NAME} with the environment variable of that name. */
export function expandEnv(text, env = process.env) {
  return String(text).replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => env[name] ?? '');
}

export const round = (n, digits = 1) =>
  n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits;
