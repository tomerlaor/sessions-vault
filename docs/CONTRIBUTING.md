# Contributing to SessionsVault

Thanks for your interest in contributing. Here's everything you need to know.

## Before You Start

**Open an issue first.** Before writing any code, open an issue describing what you want to build or fix. This prevents duplicate work and makes sure the change aligns with the project's direction.

## Branch Naming

| Type           | Pattern                | Example                     |
| -------------- | ---------------------- | --------------------------- |
| Feature        | `feature/<short-name>` | `feature/ableton-parser`    |
| Bug fix        | `fix/<short-name>`     | `fix/scan-crash-on-symlink` |
| Chore / config | `chore/<short-name>`   | `chore/update-dependencies` |

Always branch off `dev`, not `main`.

## Pull Requests

- Fill in the PR template completely
- Keep PRs focused — one feature or fix per PR
- PRs must pass CI before review (see below)
- Link the related issue in your PR description

## Code Style

**Rust:** Format with `rustfmt` before committing.

```bash
cargo fmt
cargo clippy -- -D warnings
```

**TypeScript / React:** Format with Prettier, lint with ESLint.

```bash
npx prettier --write .
npx eslint .
```

## CI Gate

Every PR runs `cargo fmt --check`, `cargo clippy`, `prettier --check`, and `eslint`. If CI fails, the PR won't be reviewed until it passes.

## Getting Help

Open a thread in [GitHub Discussions](https://github.com/tomerlaor/sessions-vault/discussions) or reach out via the issue tracker.
