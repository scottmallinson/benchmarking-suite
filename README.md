# repo-template

A language- and platform-agnostic starting point for new projects, built for
humans and AI coding agents to work in side by side.

## What you get

| Area               | Provided by                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Commit conventions | [Conventional Commits](https://www.conventionalcommits.org) via [commitlint](https://commitlint.js.org) |
| Formatting         | [EditorConfig](https://editorconfig.org) + [Prettier](https://prettier.io) for Markdown/YAML/JSON       |
| Git hooks          | [Husky](https://typicode.github.io/husky) + [lint-staged](https://github.com/lint-staged/lint-staged)   |
| Secret scanning    | [Gitleaks](https://github.com/gitleaks/gitleaks) in CI                                                  |
| CI                 | GitHub Actions: PR title/commit lint, format check, secret scan                                         |
| Dependency updates | Dependabot (GitHub Actions + npm tooling)                                                               |
| Collaboration      | Issue forms, PR template, CODEOWNERS, Code of Conduct, Security policy                                  |
| Agent support      | `AGENTS.md` (+ `CLAUDE.md` pointer) describing how agents should work here                              |
| Decisions          | Architecture Decision Records in `docs/adr`                                                             |

The only tooling dependency is Node.js (for commitlint/Prettier/hooks). Your
project's own code can be in any language; delete `package.json` and friends
if you'd rather wire up equivalents.

## Using this template

1. Click **Use this template** on GitHub (or clone and remove `.git`).
2. Replace the placeholders:
   - `LICENCE.md`: copyright holder and year (or swap the licence).
   - `.github/CODEOWNERS`: your username/team.
   - `SECURITY.md` and `CODE_OF_CONDUCT.md`: contact addresses.
   - `package.json`: `name`, `description`, `repository`.
   - This README.
3. Install the tooling and hooks:

   ```sh
   npm install
   ```

4. Enable branch protection on `main`: require PRs, require the `CI` checks,
   require linear history (squash merge recommended).

## Everyday commands

```sh
npm run format        # format everything
npm run format:check  # verify formatting (what CI runs)
npm run lint:commits  # lint commits since origin/main
```

## Commit messages

Format: `type(optional-scope): description`, e.g. `feat(api): add pagination`.
Allowed types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
`refactor`, `revert`, `style`, `test`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository layout

```
.github/        CI workflows, issue/PR templates, CODEOWNERS, Dependabot
.husky/         Git hooks (commit-msg, pre-commit)
docs/adr/       Architecture Decision Records
AGENTS.md       Instructions for AI coding agents
CONTRIBUTING.md How to contribute
```

## Licence

[MIT](LICENCE.md)
