# vaultlint — Agent Instructions

`vaultlint` is a local-first Bun/TypeScript monorepo for auditing, deduplicating, batch-editing, converting, and enhancing unencrypted password manager vault exports (Bitwarden, LastPass, 1Password, KeePass, Proton Pass, Dashlane, NordPass, Keeper, Chrome, Firefox, Safari) via a CLI and an Angular 22 Web UI.

## Workspace Layout

- `apps/cli/` (`vaultlint`) — TypeScript CLI, vault services, interactive `@clack/prompts` menu, and local HTTP server (`webServer.ts`). Unit tests live in `apps/cli/tests/` (Bun test runner).
- `apps/web/` (`web`) — Angular 22 zoneless Web UI using Signals, `@spartan-ng/brain`, `@spartan-ng/helm` (`src/app/ui/`), Tailwind CSS v4, and `@tanstack/angular-table`. Unit tests use Vitest (`ng test`). Targets evergreen browsers (`apps/web/.browserslistrc`: `last 1` Chrome/Firefox/Safari/Edge).
- `apps/site/` (`site`) — Astro + Starlight docs/marketing site (Starwind UI primitives in `src/ui/`). Deployed with the Web UI under `/app/`.
- `packages/brand/` (`@vaultlint/brand`) — Single source of brand truth for both `apps/site` and `apps/web`: `tokens.css` (colours via `light-dark()`, fonts, radius, motion, focus ring), `logo.svg`, and TS constants (name, tagline, theme colours, links, supported managers, trademark notice). Change brand values here, never in an app stylesheet.
- `packages/vault-schema/` (`@vaultlint/vault-schema`) — Canonical vault TypeScript interfaces (`VaultData`, `VaultItem`, `VaultUri`, `VaultLogin`, `VaultFolder`) and URI/domain helpers (`getUriString`, `withUpdatedUri`, `extractDomainParts`).
- `packages/vault-formats/` (`@vaultlint/vault-formats`) — Multi-provider vault format adapters, auto-detection, RFC 4180 CSV/XML/1PUX ZIP codecs, and round-trip/cross-format conversion (`parseVault`, `parseVaultAsync`, `exportVault`, `VAULT_FORMATS`).
- `packages/vault-ops/` (`@vaultlint/vault-ops`) — Framework-agnostic vault domain operations: password strength/generation/reused/HIBP (`password.ts`), URI validation/normalization/domain mappings (`uri.ts`), batch-edit variable expansion & targeting (`batch.ts`), duplicate grouping/merging/conflict analysis (`duplicates.ts`), Aegis FIDO import (`aegis.ts`), and vault breakdown stats (`health.ts`).
- `packages/ai/` (`@vaultlint/ai`) — Multi-provider AI DI/IoC framework (`IHttpClient`, `FetchHttpClient`, `IAiProvider`, `BaseAiProvider`, `OpenAiCompatibleProvider`, `AiProviderContainer`, `createDefaultAiContainer`, and adapters for OpenAI, Anthropic, OpenRouter, Grok, Gemini, and Ollama).
- `e2e/` — Playwright Chromium end-to-end tests against the Web UI (`playwright.config.ts`).
- `docs/` — End-user documentation (`USER_GUIDE.md`).
- `.agents/` — Workspace subagents (`security-reviewer`, `cli-web-parity`) and skills (`vaultlint-check`, `vaultlint-cli-feature`, `vaultlint-web-feature`).

## Tooling & Verification Commands

Use **Bun** (`bun >= 1.4`) from the repository root:

- `bun run check` — Run `lint` (`oxlint`), `format:check` (`oxfmt`), `typecheck`, and `test` (CLI + Web unit tests). Run this before concluding any code change.
- `bun run format` — Auto-format code with `oxfmt` (`.oxfmtrc.json`).
- `bun run build` — Build both `apps/cli/dist/` and `apps/web/dist/`.
- `bun run e2e` — Run Playwright E2E tests (`e2e/*.spec.ts`). Run whenever Web UI components, routing, or E2E tests change.
- `bun run e2e:site` — Build the Astro site and run axe WCAG 2.2 AA checks on it (`e2e-site/`, `playwright.site.config.ts`). Run whenever `apps/site` or `packages/brand` changes.
- `bun run audit:sample` — Smoke-test the CLI against `apps/cli/tests/fixtures/vault.json`.

## Core Architectural & Security Rules

1. **100% Local Processing by Default**: Never add network calls to default vault audit, merge, or edit paths.
   - HIBP breach checks must remain opt-in and use k-anonymity (SHA-1 5-char prefix only).
   - AI categorization (`--enable-ai` / Web UI opt-in) must remain opt-in and send only item names and hostnames — never passwords, usernames, TOTP secrets, or notes.
   - HTTP redirect / dead-link checks (`--check-redirects` / Web UI) and mobile store lookups (`--validate-mobile-uris` / Web UI) must remain opt-in.
2. **Never Expose Plaintext Passwords in Logs or Reports**: Mask passwords in CLI tables, activity logs, and exported reports (`.json` / `.md`). Never persist plaintext vault secrets or API keys to `localStorage`.
3. **Reject Encrypted Exports**: Encrypted exports (Bitwarden `encrypted: true`, Proton Pass `encrypted: true`, KeePass `.kdbx`) must be rejected cleanly to prevent corruption.
4. **Shared Packages First (SOLID / DI / IoC)**: Keep canonical vault schema types in `packages/vault-schema`, format adapters/codecs in `packages/vault-formats`, pure vault operations in `packages/vault-ops`, and AI provider adapters/IoC in `packages/ai` rather than duplicating business logic in `apps/cli` or `apps/web`.
5. **TypeScript & ES2026**: All packages and apps target `ESNext` with strict typechecking (`isolatedModules`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`).
6. **Angular 22 Zoneless + Modern CSS**:
   - Use standalone components, `inject()`, Signals (`signal`, `computed`, `input`, `output`, `model`, `viewChild`), and `@spartan-ng/brain` / `apps/web/src/app/ui/` primitives. `OnPush` is enabled by default in Angular 22 — omit redundant `changeDetection: ChangeDetectionStrategy.OnPush`.
   - Use modern CSS (`light-dark()`, `color-scheme` synced with `<meta name="color-scheme">`, `scrollbar-gutter: stable`, `text-wrap: balance`/`pretty`).
7. **Never Commit Sensitive Vault Data**: `.ref/` is gitignored for local testing fixtures; never commit real vault exports or credentials.
