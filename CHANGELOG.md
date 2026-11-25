# Changelog

## [1.2.0](https://github.com/robertbaker/vaultlint/compare/v1.1.0...v1.2.0) (2026-11-25)

### Features

- **web:** unify session controls, mobile nav spacing, and AI card baselines ([3318ea6](https://github.com/robertbaker/vaultlint/commit/3318ea65c72e889d8435e41f068192e49fe0906b))

### Bug Fixes

- **web:** resolve select arrows, theme toggle icons, toast overlap, and paint lag ([24a1a10](https://github.com/robertbaker/vaultlint/commit/24a1a10c7f3327988e1fbd79ad380d85667e6745))

## [1.1.0](https://github.com/robertbaker/vaultlint/compare/v1.0.1...v1.1.0) (2026-11-25)

### Features

- **web:** finish pluralizing store notifications and polish coverage close button ([c21f823](https://github.com/robertbaker/vaultlint/commit/c21f8233f542e8dce33399792954fb0bc5adebe8))
- **web:** improve UI/UX across landing, explorer, and review panels ([9d587aa](https://github.com/robertbaker/vaultlint/commit/9d587aa79c7766331aae9a0606a7517f47e07747))
- **web:** polish changelog accordions and pluralize UI copy ([62b8f0a](https://github.com/robertbaker/vaultlint/commit/62b8f0a5e4745704d95c5cc385b8e18fea44b41f))
- **web:** polish lint accordions, password strength meter, and AI actions ([c22be7a](https://github.com/robertbaker/vaultlint/commit/c22be7ab585394ec36d36bcbd2b0ea0c646f4ab5))
- **web:** remove duplicate footer landmark and polish copy ([7fb52de](https://github.com/robertbaker/vaultlint/commit/7fb52deb191cab50c8cb131867c60a26d0ea9020))

## 1.0.1 (2026-11-23)

### Bug Fixes

- **styles:** adjust main frame padding for sticky header ([0b97dc4](https://github.com/robertbaker/vaultlint/commit/0b97dc485929ea33302a8496e0d9332e416eed7a))

All notable changes to this project will be documented in this file.

The format is based on [Conventional Commits](https://www.conventionalcommits.org/), and this project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Added Enpass JSON/login CSV, Keeper JSON, and RoboForm CSV adapters; expanded NordPass CSV mappings.
- Added Zod validation and a complete developer reference for all 20 supported format adapters.
- Documented that encrypted Bramble backups must be exported through KeePassXC before vaultlint can read them.
