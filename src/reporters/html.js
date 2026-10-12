import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');

/** One page with the viewer and this run's results inlined: opens from disk, can be emailed. */
export async function writeHtml({ outDir, results }) {
  const [html, css, js] = await Promise.all(
    ['index.html', 'style.css', 'app.js'].map((f) => readFile(path.join(SITE_DIR, f), 'utf8')),
  );
  const data = JSON.stringify(results).replace(/</g, '\\u003c');
  const replaced = [
    [/<link\s+rel="stylesheet"\s+href="style\.css"\s*\/?>/, () => `<style>${css}</style>`],
    [
      /<script\s+type="module"\s+src="app\.js"\s*><\/script>/,
      () =>
        `<script type="application/json" id="embedded">${data}</script><script type="module">${js}</script>`,
    ],
    [
      /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/,
      () =>
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" />`,
    ],
  ];
  let page = html;
  for (const [pattern, to] of replaced) {
    if (!pattern.test(page))
      throw new Error(`site/index.html no longer matches ${pattern}; report.html cannot be built`);
    page = page.replace(pattern, to);
  }
  await writeFile(path.join(outDir, 'report.html'), page);
}
