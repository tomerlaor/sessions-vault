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

## Releasing (macOS signing & notarization)

Pushing a tag matching `v*.*.*` triggers `.github/workflows/release-build.yml`,
which builds a universal macOS binary and attaches a DMG to a GitHub release.

### Secrets

If `APPLE_CERTIFICATE` is set, the workflow signs the app with your Developer ID
certificate and notarizes it with Apple before uploading. If it's not set, the
workflow still builds and publishes a DMG, but it's **unsigned** — see
"Unsigned builds" below.

**Signing (required for a signed build):**

| Secret                       | Description                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64-encoded Developer ID Application `.p12` certificate                            |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`                                               |
| `APPLE_SIGNING_IDENTITY`     | The certificate's common name, e.g. `Developer ID Application: Jane Doe (TEAMID1234)` |
| `KEYCHAIN_PASSWORD`          | Optional. Password for the temporary CI keychain tauri-action creates                 |

To export the `.p12` from Keychain Access: select your "Developer ID
Application" certificate, right-click → **Export**, save as `.p12`, set an
export password (this is `APPLE_CERTIFICATE_PASSWORD`), then base64-encode it:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

Paste the result as `APPLE_CERTIFICATE`.

**Notarization — pick one of the two options below:**

_(A) Apple ID path:_

| Secret           | Description                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `APPLE_ID`       | Your Apple ID email                                                                                          |
| `APPLE_PASSWORD` | An **app-specific password** for that Apple ID (not your login password — generate one at appleid.apple.com) |
| `APPLE_TEAM_ID`  | Your Apple Developer Team ID                                                                                 |

_(B) App Store Connect API key path:_

| Secret             | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `APPLE_API_KEY`    | The API key ID                                                                   |
| `APPLE_API_ISSUER` | The issuer ID for the API key                                                    |
| `APPLE_API_KEY_P8` | The raw contents of the `.p8` private key file downloaded from App Store Connect |

CI writes `APPLE_API_KEY_P8` to a temporary file under `$RUNNER_TEMP` and
points `APPLE_API_KEY_PATH` at it for that run only; the file is deleted at
the end of the job. `APPLE_API_KEY_PATH` itself cannot be stored as a secret
since it's a filesystem path, not a credential.

### Unsigned builds

Without `APPLE_CERTIFICATE`, the workflow logs a warning and builds an
unsigned DMG. It's still attached to a draft release so it's available for
manual testing, but macOS Gatekeeper will refuse to open it without the user
bypassing Gatekeeper manually.

### Release flow

1. Push a tag, e.g. `git tag v0.3.0 && git push origin v0.3.0`.
2. The workflow builds, signs, notarizes, and verifies the app, then creates a
   **draft** GitHub release with the DMG attached.
3. Download the DMG and confirm it opens without a Gatekeeper warning.
4. Publish the draft release once it looks good.

Releases are always created as drafts — nothing goes live to users until
someone verifies the build and publishes it manually.

> The Tauri updater (`TAURI_SIGNING_PRIVATE_KEY`) is tracked separately in
> #44, and Windows code signing in #45. Both are out of scope for the macOS
> signing/notarization work above.

## Getting Help

Open a thread in [GitHub Discussions](https://github.com/tomerlaor/sessions-vault/discussions) or reach out via the issue tracker.
