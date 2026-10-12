# AGENTS.md

Guidance for AI coding agents (and a useful summary for humans). Tool-specific
files such as `CLAUDE.md` point here so there is a single source of truth.

## Project overview

<!-- Replace with a 2-3 sentence description of what this project is. -->

Template repository. Replace this section when you start a real project.

## Commands

<!-- Keep these accurate; agents rely on them to verify their work. -->

| Task             | Command                      |
| ---------------- | ---------------------------- |
| Install          | `npm install` (tooling only) |
| Test             | `npm test`                   |
| Format           | `npm run format`             |
| Check formatting | `npm run format:check`       |
| Everything       | `npm run check`              |
| Lint commits     | `npm run lint:commits`       |
| Run the CLI      | `node bin/bench.js help`     |

A test that guards an invariant (a gate blocks, a failed answer fails, a path is not served) is not finished
until you have broken the thing it guards and watched the test fail.

## Conventions

- Commits and PR titles follow Conventional Commits (see `CONTRIBUTING.md`).
- Follow `.editorconfig`; run `npm run format` before committing.
- Match the style of surrounding code; don't reformat unrelated files.
- Keep changes small and focused; one logical change per PR.
- Add or update tests and docs with every behavioural change.
- Record significant design decisions in `docs/adr/`.

## Boundaries

- Never commit secrets, credentials, or `.env` files.
- Commits are authored by the human user; never add `Co-Authored-By`,
  `Generated with`, or other AI attribution to commits, PR bodies or comments
  (enforced in `.claude/settings.json`).
- Never bypass hooks (`--no-verify`) or disable checks to get green.
- Never force-push to `main` or rewrite shared history.
- Ask before: adding dependencies, changing CI or release config, deleting
  files you didn't create, or making breaking changes.

## Definition of done

1. Checks above pass locally.
2. Tests and docs updated.
3. PR description explains the _why_, links the issue, and notes risks.
