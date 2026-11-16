---
name: vaultlint-cli-feature
description: >-
  Use this skill when adding or modifying CLI flags, vault services, interactive
  prompts, or report exports in apps/cli.
---

# Adding or Modifying a vaultlint CLI Feature

## Key Files

- `packages/vault-schema/src/index.ts` — Canonical vault types & URI/domain helpers (`@vaultlint/vault-schema`).
- `packages/vault-formats/src/` — Multi-provider format adapters, auto-detection, CSV/XML/1PUX codecs (`@vaultlint/vault-formats`).
- `packages/vault-ops/src/` — Pure vault operations (`password.ts`, `uri.ts`, `batch.ts`, `duplicates.ts`, `aegis.ts`, `health.ts`) (`@vaultlint/vault-ops`).
- `packages/ai/src/` — Multi-provider AI DI/IoC framework (`@vaultlint/ai`).
- `apps/cli/src/cli.ts` — Commander option definitions, filter validation, and help examples.
- `apps/cli/src/vaultManager.ts` — Orchestration (`runVaultEnhancement`, `filterVaultItems`, `previewBatchEdits`).
- `apps/cli/src/vaultService.ts` — Load/save vault (`IVaultStorage`), weak/reused/HIBP (`IHibpRangeClient`) password checks, URI audit, health score.
- `apps/cli/src/undoRedoManager.ts` — Generic `UndoRedoHistory<T>` manager and default history helpers.
- `apps/cli/src/webServer.ts` — Local static Web UI server (`WebServerOptions`).
- `apps/cli/src/duplicateService.ts` — Duplicate detection and merging.
- `apps/cli/src/batchService.ts` — Regex batch editing and normalization.
- `apps/cli/src/cliInteractive.ts` — `@clack/prompts` interactive menu.
- `apps/cli/tests/` — Bun unit tests and fixtures (`tests/fixtures/vault.json`).

## Steps

1. **Check shared packages & TypeScript 7 conventions first**: Put schema types in `@vaultlint/vault-schema`, format codecs in `@vaultlint/vault-formats`, pure domain operations in `@vaultlint/vault-ops`, and AI adapters in `@vaultlint/ai`. Keep `apps/cli/src/*` as thin CLI/FS/UI wrappers using injectable abstractions (`IVaultStorage`, `IHibpRangeClient`, `UndoRedoHistory<T>`). Follow `verbatimModuleSyntax` and `erasableSyntaxOnly` (`import type` for types, `satisfies` for config maps, no parameter properties or `enum`).
2. **Preserve privacy & safety invariants**:
   - Reject `encrypted: true` vaults.
   - Mask passwords in all table, JSON, and Markdown outputs.
   - Support `--dry-run` for mutating operations and avoid network calls unless explicitly opted in.
3. **Wire CLI options**:
   - Add flags to `setupCLI` in `apps/cli/src/cli.ts` and `VaultEnhancementOptions` in `apps/cli/src/vaultManager.ts`.
   - If the option is useful interactively, expose it in `apps/cli/src/cliInteractive.ts`.
4. **Add Bun unit tests**:
   - Add tests in `apps/cli/tests/*.test.ts` covering both happy paths and edge cases (missing fields, invalid regex, `--dry-run`).
5. **Update docs if user-facing**:
   - Update `README.md` and `docs/USER_GUIDE.md` if new CLI flags or workflows were added.
6. **Verify**:
   - Run `bun run check`, `bun run build:cli`, and `bun run audit:sample`.
