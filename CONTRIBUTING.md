# Contributing

Thanks for helping out! These guidelines apply equally to humans and AI agents.
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

```sh
git clone <your-fork-or-repo-url>
cd <repo>
npm install   # installs tooling and Git hooks
```

## Workflow

1. Open or find an issue describing the change. For anything non-trivial,
   agree on the approach before writing code.
2. Branch from `main`: `type/short-description` (e.g. `feat/user-export`).
3. Make small, focused commits.
4. Run the checks locally (`npm run format:check`, plus your project's tests).
5. Open a pull request using the template. Keep PRs small and reviewable.
6. Address review feedback with new commits; the PR is squash-merged.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org), enforced by
commitlint through a `commit-msg` hook and in CI.

```
<type>(<scope>)<!>: <subject>

<body>

<footer>
```

- Types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
  `revert`, `style`, `test`.
- Subject: imperative mood, lower case, no trailing full stop, max 100 chars.
- Breaking changes: add `!` after the type/scope and/or a `BREAKING CHANGE:`
  footer.
- Reference issues in the footer: `Closes #123`.

Because PRs are squash-merged, the **PR title** must also follow this format.

## Code style

- `.editorconfig` is the source of truth for whitespace and line endings.
- Prettier formats Markdown, YAML and JSON automatically on commit.
- Add language-specific linters/formatters for your stack and wire them into
  `lint-staged` (in `package.json`) and CI.

## Tests and docs

- New behaviour needs tests; bug fixes need a regression test.
- Update docs in the same PR as the code change.
- Record significant architectural decisions as an ADR in `docs/adr`.

## Security

Never commit secrets. Report vulnerabilities privately; see
[SECURITY.md](SECURITY.md).
