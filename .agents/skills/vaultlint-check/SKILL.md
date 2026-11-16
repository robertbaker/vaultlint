---
name: vaultlint-check
description: >-
  Use this skill to run the full vaultlint verification suite (oxlint, oxfmt,
  TypeScript typechecking, shared package Bun tests, shared package Bun tests, CLI Bun tests, Angular Vitest tests, production
  builds, and Playwright E2E tests) and fix any failures.
---

# vaultlint Verification Workflow

Run verification from the repository root (`d:\git\vaultlint`) using Bun.

## Steps

1. **Run the fast check gate** (`oxlint`, `oxfmt --check`, `typecheck` across all 6 workspaces, shared package Bun tests, shared package Bun tests, CLI Bun tests, and Web Vitest tests):
   ```bash
   bun run check
   ```
   - If `format:check` fails, run `bun run format` and re-run `bun run format:check`.
   - If `lint` fails, inspect the `oxlint` output (config: `oxlint.json`) and fix warnings/errors.
   - If `typecheck` fails, check strict ESNext rules (`isolatedModules`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`).
2. **Build both apps** (required before `bun run ui` or `e2e` if CLI/Web changed):
   ```bash
   bun run build
   ```
3. **Run Playwright E2E tests** (when `apps/web`, `packages/*`, or `e2e/` changed):
   ```bash
   bun run e2e
   ```
4. **Smoke-test the CLI** (when `apps/cli` changed):
   ```bash
   bun run audit:sample
   ```

## Success Criteria

- `bun run check` exits with code `0` and 0 lint warnings/errors.
- `bun run build` succeeds for both `vaultlint` (`apps/cli`) and `web` (`apps/web`).
- `bun run e2e` passes all specs in `e2e/` when UI or shared code was modified.
