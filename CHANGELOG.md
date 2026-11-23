# Changelog

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
