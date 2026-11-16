# vaultlint Web UI

Angular 22 zoneless web application for `vaultlint`, built with Signals, `@spartan-ng/brain`, `@spartan-ng/helm`, and `@tanstack/angular-table`.

Run commands from the repository root using Bun:

- `bun run dev:web`: Start the Angular dev server at `http://localhost:4200/`
- `bun run build:web`: Production build to `apps/web/dist/`
- `bun run test:web`: Run Vitest unit tests
- `bun run e2e`: Run Playwright end-to-end tests (`e2e/`)
- `bun run ui`: Build the Web UI and serve it via the CLI server at `http://127.0.0.1:4173`
