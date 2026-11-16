# vaultlint

[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/vaultlint.svg)](https://www.npmjs.com/package/vaultlint)
[![Node](https://img.shields.io/node/v/vaultlint.svg)](https://nodejs.org/)
[![CI](https://github.com/robertbaker/vaultlint/actions/workflows/ci.yml/badge.svg)](https://github.com/robertbaker/vaultlint/actions/workflows/ci.yml)

Audit, deduplicate, batch-edit, and convert unencrypted password manager exports (Bitwarden, LastPass, 1Password, KeePass, Proton Pass, Dashlane, NordPass, Keeper, Chrome, Firefox, Safari, and more) with a local TypeScript CLI or browser-based interface. Everything runs on your machine by default.

```bash
npx vaultlint --input vault.json --audit --dry-run   # read-only audit
npx vaultlint --ui                                   # local Web UI at http://127.0.0.1:4173
```

> **Disclaimer:** This is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Bitwarden, 1Password, KeePass, Proton, LastPass, Dashlane, NordPass, Enpass, Keeper, RoboForm, Bramble, Aegis, Google, Microsoft, Mozilla, Brave Software, or Apple. All product names and trademarks belong to their respective owners.

**Contents:** [Privacy & Security](#privacy--security) · [Supported Formats](#supported-formats) · [Features](#features) · [Getting Started](#getting-started) · [CLI Usage](#cli-usage) · [CI Usage](#ci-usage) · [Development Scripts](#development-scripts) · [Project Structure](#project-structure) · [Contributing](#contributing) · [License](#license)

---

## Privacy & Security

- **Local Processing**: Vault parsing, duplicate merging, password checks, batch editing, domain mapping, and password generation run on your machine or in your browser.
- **Unencrypted Exports Only**: Encrypted exports (Bitwarden `encrypted: true`, Proton Pass `encrypted: true`, KeePass `.kdbx`, and Bramble `.bramble`) are rejected so they aren't corrupted. To analyze Bramble data, export KeePass, open its password-protected `.kdbx` in KeePassXC, and export CSV or XML. Always keep a backup of your original export before writing changes.
- **Optional Network Features**: HIBP, AI, redirect, and mobile-app checks make requests only when you run them. HIBP sends a 5-character SHA-1 hash prefix. AI sends only item names and hostnames, not item IDs, passwords, usernames, TOTP secrets, FIDO keys, or notes. See the [privacy guide](apps/site/src/content/docs/security/privacy-policy.mdx) for details.

---

## Supported Formats

20 formats across 13 password manager and browser families. Auto-detection picks the right adapter; override it with `--input-format` / `--output-format`, and run `vaultlint --list-formats` for exact IDs.

| Provider                 | Formats   |
| ------------------------ | --------- |
| Bitwarden                | JSON, CSV |
| LastPass                 | CSV       |
| 1Password                | 1PUX, CSV |
| KeePass / KeePassXC      | XML, CSV  |
| Proton Pass              | JSON, CSV |
| Dashlane                 | JSON, CSV |
| NordPass                 | CSV       |
| Enpass                   | JSON, CSV |
| Keeper                   | JSON, CSV |
| RoboForm                 | CSV       |
| Chrome / Edge / Brave    | CSV       |
| Firefox                  | CSV       |
| Safari / Apple Passwords | CSV       |

Any supported format can be converted to any other. Known data-loss warnings (fields a target format cannot hold) are shown before export.

---

## Features

For accepted headers, JSON fields, and provider-specific import/export limits, see the [format schema reference](apps/site/src/content/docs/cli/format-schemas.mdx) and [supported format matrix](apps/site/src/content/docs/cli/formats.mdx).

### Web UI

The browser interface is organized into five sections (**Items**, **Review**, **Organize**, **AI**, **Activity**), each with a short heading describing it. It supports:

- **Vault Import & Export**: Drag-and-drop unencrypted vault exports across 20 formats, built-in **Sample Vault**, format conversion, and sanitized audit report export.
- **Vault Explorer**: Sortable, paginated TanStack Table with row selection, bulk password regeneration/deletion, quick search (`/` shortcut), issue filters (`Weak`, `Reused`, `Duplicate`, `FIDO`), clipboard copy, password reveal, and Add/Edit item dialog with live password strength meter and folder assignment.
- **Duplicates**: Side-by-side duplicate group inspection and one-click or bulk merge (combining unique URIs and preferring the most recently modified credentials).
- **Vault Migration**: Compare a second export with the loaded vault, review match confidence, decide field conflicts individually, and download a sanitized decision report.
- **Export Coverage Preview**: Compare in-memory export and re-import results across supported formats; reports show field labels and counts without vault values.
- **Password Health**: Review the health score, find weak or reused passwords and malformed URIs, generate replacements, and optionally check breaches with HIBP.
- **Shared Audit Profiles**: Create and manage multiple named lint profiles, save them in the browser, or import/export `vaultlint.config.json` profiles for use by the CLI.
- **Batch Edit & Domain Mappings**: Preview regex changes, normalize names and URIs, and map subdomains to canonical domains. Mapping rules are saved in `localStorage`.
- **FIDO Import**: Import credentials from Aegis or compatible unencrypted JSON exports.
- **Undo / Redo & Activity Log**: Multi-step Undo/Redo (`Ctrl+Z` / `Ctrl+Y`) and a timestamped session activity log.

### CLI

- **Vault Audits** (`--audit`, `--stats`, `--list`, `--search`, `--filter`) with masked passwords and `--json`, `--verbose`, `--quiet`, or `--no-color` output modes.
- **Interactive Menu** (`--interactive` / `-I`) for common vault tasks.
- **Deduplication & Batch Editing**: `--detect-duplicates`, `--auto-merge`, `--normalize`, and regex `--batch-edit` across `name`, `uri`, `username`, or `notes`.
- **Password and URI Checks**: `--check-weak-passwords`, `--fix-weak-passwords`, `--check-reused-passwords`, `--fix-reused-passwords`, `--check-uris`, `--validate-mobile-uris`, and `--generate-password [length]`.
- **Safe Dry Runs, Backups & Reports**: `--dry-run` previews changes without writing vault files; `--in-place` with `--backup` creates `.bak` backups; `--export-report <path>` writes a `.json` or `.md` summary; `--sarif <path>` writes sanitized SARIF 2.1.0 findings; `--sarif-baseline <path> --fail-on-new` gates CI on new findings.
- **Vault Migration**: `--merge-input <path>` compares a second export; `--prefer-incoming` selects incoming values for conflicting fields, and `--migration-report <path>` writes a sanitized decision record.
- **Vendor CLI Integration**: `--from-cli bitwarden|lastpass|dashlane|keeper|1password|proton-pass|nordpass|enpass` reads a live vault through a provider CLI (in memory, no temp files); Enpass uses the optional community `enpasscli` reader. `--push-to-cli` writes changes back to Bitwarden with a previewed plan, drift check, and trash-only deletes.
- **Local Web UI Server**: `--ui` (with optional `--port <number>`, default `4173`) serves the built Angular app on `127.0.0.1`.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (`bun >= 1.4`)
- Node.js (optional, for Playwright end-to-end tests; required to run the published npm package)

### Install from npm

Requires Node.js 22.12 or newer. Pick your package manager (GitHub READMEs have no real tabs, so each manager is a collapsible block):

<details open>
<summary><b>npm</b></summary>

```bash
# Install globally
npm install -g vaultlint

# Or run once without installing
npx vaultlint --help
```

</details>

<details>
<summary><b>pnpm</b></summary>

```bash
pnpm add -g vaultlint
pnpm dlx vaultlint --help
```

</details>

<details>
<summary><b>Yarn</b></summary>

```bash
# Yarn Classic (1.x)
yarn global add vaultlint

# Yarn 2+ has no global install; run once instead
yarn dlx vaultlint --help
```

</details>

<details>
<summary><b>Bun</b></summary>

```bash
bun add -g vaultlint
bunx vaultlint --help
```

</details>

Then run `vaultlint --help`. The package bundles the Web UI, so `vaultlint --ui` works without a build step.

### Install from source

```bash
git clone https://github.com/robertbaker/vaultlint.git
cd vaultlint

# Install dependencies across all workspaces (apps/* and packages/*)
bun run install:all
```

### Build & Launch the Web UI

```bash
# Build CLI + Angular Web UI
bun run build

# Build and start the local Web UI server at http://127.0.0.1:4173
bun run ui
```

---

## CLI Usage

Examples use the installed `vaultlint` command. From a source checkout, use `bun start --` instead (for example `bun start -- --help`).

```bash
# Show all CLI flags and examples
vaultlint --help

# Run a full local audit on a vault without modifying files
vaultlint -i vault.json --audit --dry-run

# List items with weak passwords
vaultlint -i vault.json --list --filter weak

# Merge duplicates, fix weak & reused passwords, and save to a new file + report
vaultlint -i vault.json -o vault-clean.json --auto-merge --fix-weak-passwords --fix-reused-passwords --export-report report.json

# Preview a regex batch edit on URIs
vaultlint -i vault.json --batch-edit --field uri --pattern "^http://" --replacement "https://" --dry-run

# Launch the interactive guided CLI menu
vaultlint -i vault.json --interactive

# Generate a 20-character strong password
vaultlint --generate-password 20

# Start the local Web UI on a custom port
vaultlint --ui --port 4173
```

For a walkthrough of both the Web UI and CLI workflows, see [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

---

## CI Usage

Fail a pipeline on lint findings, or only on findings that are new since a previous run, using SARIF 2.1.0 output (sanitized, no secrets):

```bash
# Write findings for code scanning
vaultlint -i vault.json --lint --sarif vaultlint.sarif

# Fail only when findings are new relative to a baseline
vaultlint -i vault.json --lint --sarif current.sarif   --sarif-baseline baseline.sarif --fail-on-new
```

Run `vaultlint --list-rules` to see all 14 lint rules with their default severity and autofix support, and choose a preset with `--ruleset recommended|strict|minimal`. Treat vault exports as secrets: do not commit them or upload them as CI artifacts.

---

## Development Scripts

| Script                  | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `bun run install:all`   | Install dependencies across all workspaces (`apps/*`, `packages/*`)              |
| `bun run build`         | Build CLI (`apps/cli/dist/`) and Angular Web UI (`apps/web/dist/`)               |
| `bun run ui`            | Build Web UI and start local server on `http://127.0.0.1:4173`                   |
| `bun run dev:ui`        | Build Web UI and run CLI server in watch mode                                    |
| `bun run test`          | Run CLI unit tests (`bun test`) and Angular Vitest tests (`ng test`)             |
| `bun run test:all`      | Run all unit tests and Playwright E2E tests                                      |
| `bun run e2e`           | Run Playwright Chromium end-to-end tests (`e2e/*.spec.ts`)                       |
| `bun run lint`          | Lint TypeScript and test files with `oxlint`                                     |
| `bun run format`        | Format source, test, and Angular files with `oxfmt`                              |
| `bun run format:check`  | Verify formatting without modifying files                                        |
| `bun run typecheck`     | Typecheck all workspaces (`apps/*` and `packages/*`)                             |
| `bun run check`         | Run `lint`, `format:check`, `typecheck`, and `test`                              |
| `bun run audit:sample`  | Run a dry-run duplicate and weak-password audit against the sample fixture vault |
| `bun run e2e:site`      | Build the Astro site and run axe WCAG 2.2 AA checks on it                        |
| `bun run build:publish` | Assemble `publish/`, the exact tree shipped to npm                               |
| `bun run test:publish`  | Smoke-test the assembled `publish/` package                                      |
| `bun run clean`         | Remove `apps/cli/dist/` and `apps/web/dist/` build artifacts                     |

---

## Project Structure

```text
vaultlint/
├── apps/
│   ├── cli/                  # TypeScript CLI, vault services, interactive UI, and local HTTP server
│   │   ├── src/
│   │   └── tests/            # Bun unit tests and sample fixtures (tests/fixtures/vault.json)
│   ├── site/                 # Astro Starlight documentation site
│   └── web/                  # Angular 22 zoneless Web UI workspace
├── packages/
│   ├── vault-schema/         # Canonical vault types & URI/domain helpers (@vaultlint/vault-schema)
│   ├── vault-formats/        # Multi-provider format adapters & codecs (@vaultlint/vault-formats)
│   ├── vault-ops/            # Batch-edit, password, URI, & duplicate ops (@vaultlint/vault-ops)
│   ├── brand/                # Shared brand tokens, logo, and constants (@vaultlint/brand)
│   └── ai/                   # Multi-provider AI DI/IoC framework (@vaultlint/ai)
├── e2e/                      # Playwright end-to-end tests for the Web UI
├── docs/                     # User guide documentation
├── .agents/                  # Workspace AI agent definitions and skills
├── AGENTS.md                 # Repository guidelines for AI coding agents
└── .github/workflows/        # GitHub Actions CI & release workflows
```

---

## Contributing

1. Fork the repository on GitHub.
2. Create a feature branch (`git checkout -b feat/my-change`).
3. Run `bun run check` to ensure linting, formatting, typechecking, and tests pass.
4. Open a pull request.

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**, matching the open-source license used by [Bitwarden](https://github.com/bitwarden/clients). See [LICENSE](LICENSE) for the full text.
