# AGENTS.md

Guidance for AI coding agents (and a useful summary for humans). Tool-specific
files such as `CLAUDE.md` point here so there is a single source of truth.

## Project overview

<!-- Replace with a 2-3 sentence description of what this project is. -->

Template repository. Replace this section when you start a real project.

## Commands

<!-- Keep these accurate; agents rely on them to verify their work. -->

| Task             | Command                |
| ---------------- | ---------------------- |
| Install          | `npm install`          |
| Format           | `npm run format`       |
| Check formatting | `npm run format:check` |
| Lint commits     | `npm run lint:commits` |

Add build, test and lint commands for your stack here.

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
