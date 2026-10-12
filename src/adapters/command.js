import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseAnswer, promptText } from './common.js';
import { expandEnv } from '../util.js';

/**
 * Run any program for each question. The component can be a script, a CLI, a container
 * (`docker run -i …`), or a shell pipeline written as `["sh","-c","…"]`.
 *
 * options: command, args, cwd, env, timeoutMs, stdin ("json" sends { input, seed }; "text" sends the prompt)
 * The program answers on stdout: plain text, or JSON { text, toolCalls?, metrics? }.
 */
export function create({ options = {}, baseDir }) {
  if (!options.command) throw new Error('the command adapter needs options.command');
  return {
    run(input, { seed }) {
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const child = spawn(
          expandEnv(options.command),
          (options.args ?? []).map((a) => expandEnv(a)),
          {
            cwd: options.cwd ? path.resolve(baseDir, options.cwd) : baseDir,
            env: { ...process.env, ...options.env },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(
            new Error(`no answer after ${Math.round((options.timeoutMs ?? 300_000) / 1000)} s`),
          );
        }, options.timeoutMs ?? 300_000);
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0)
            return reject(
              new Error(`exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`),
            );
          const answer = parseAnswer(out, options.textPath);
          answer.metrics = { totalMs: Math.round(performance.now() - started), ...answer.metrics };
          resolve(answer);
        });
        child.stdin.on('error', () => {});
        child.stdin.end(
          options.stdin === 'text' ? promptText(input) : JSON.stringify({ input, seed }),
        );
      });
    },
  };
}
