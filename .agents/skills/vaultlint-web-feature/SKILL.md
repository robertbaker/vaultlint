---
name: vaultlint-web-feature
description: >-
  Use this skill when adding or modifying Angular 22 components, signals state,
  Spartan UI primitives, Vitest specs, or Playwright E2E tests in apps/web and e2e.
---

# Adding or Modifying a vaultlint Web UI Feature

## Key Files

- `apps/web/src/app/core/vault-store.service.ts` — Thin Signal-based state shell delegating pure logic to `@vaultlint/vault-ops`, `@vaultlint/vault-formats`, and `@vaultlint/ai`.
- `apps/web/src/app/core/ai-container.token.ts` — Angular DI `InjectionToken` for `AiProviderContainer`.
- `apps/web/src/app/core/storage.token.ts` — Angular DI `InjectionToken` (`BROWSER_STORAGE`) abstracting `localStorage`.
- `apps/web/src/app/core/theme.service.ts` & `changelog.service.ts` — Root DI services for `color-scheme` theme sync and unread changelog state.
- `apps/web/src/app/core/vault.models.ts` — Web UI view models (re-exporting/extending `@vaultlint/vault-schema` and `@vaultlint/vault-ops`).
- `apps/web/src/app/features/` — Feature panels (`vault-explorer`, `duplicates-panel`, `security-panel`, `batch-edit-panel`, `aegis-import-panel`, `activity-log-panel`, `edit-item-dialog`, `changelog-dialog`).
- `apps/web/src/app/ui/` — Spartan UI (`hlm-*`) primitives.
- `apps/web/src/styles.css` — Tailwind v4 + modern 2026 CSS (`@layer base`, `light-dark()`, `oklch()`, `color-mix()`, `accent-color`, `scrollbar-color` + `scrollbar-width`, `@starting-style` + `allow-discrete`, `corner-shape: squircle`, `flex-wrap-balance`, `content-auto`, `.skip-link`).
- `e2e/` — Playwright specs (`vault-ui.spec.ts`, `changelog.spec.ts`).

## Steps

1. **Follow Angular 22 zoneless + signals + modern CSS patterns**:
   - Use standalone components, `inject()`, `signal()`, `computed()`, `input()`, `output()`, `model()`, and `viewChild()`. Omit redundant `changeDetection: ChangeDetectionStrategy.OnPush` (`OnPush` is enabled by default in Angular 22).
   - Keep pure vault domain logic in `@vaultlint/vault-ops` rather than inside Angular services or components, and inject `BROWSER_STORAGE` / root services (`ThemeService`, `ChangelogService`) rather than calling `localStorage` directly in components.
   - Reuse existing `apps/web/src/app/ui/` (`hlm-*`) and `apps/web/src/app/shared/spartan/` components before creating new primitives.
   - Follow modern CSS & accessibility conventions in `styles.css` (`@layer base`, `light-dark()`, `@container`, `@starting-style` gated by `prefers-reduced-motion: no-preference`, `scope="col"` / `aria-sort` on tables, `sr-only` with `focus-within` rings for file inputs; target evergreen `last 1` browsers via `apps/web/.browserslistrc`).
2. **Keep state mutations undoable**:
   - Perform vault mutations through `VaultStoreService` so Undo (`Ctrl+Z`), Redo (`Ctrl+Y`), and the Activity Log stay accurate.
   - Never store plaintext vault secrets or AI API keys in `localStorage`.
3. **Add unit and E2E tests**:
   - Add Vitest specs (`*.spec.ts`) in `apps/web/src/app/`.
   - Add or update Playwright E2E assertions in `e2e/` for user-visible flows.
4. **Verify**:
   - Run `bun run check`, `bun run build:web`, and `bun run e2e`.
