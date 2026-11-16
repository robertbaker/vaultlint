# vaultlint User Guide

vaultlint audits, edits, and converts unencrypted password manager exports. Processing is local by default. Keep the original export as a backup, and start with a dry run before saving changes.

## Export a vault

Export an unencrypted backup from your password manager or browser. Supported providers and file types are listed in the [format guide](../apps/site/src/content/docs/cli/formats.mdx); field mappings are in the [schema reference](../apps/site/src/content/docs/cli/format-schemas.mdx).

Encrypted exports are not supported. This includes locked Bitwarden or Proton Pass JSON, KeePass `.kdbx`, and Bramble `.bramble` files. To use a Bramble vault, open its password-protected KeePass export in KeePassXC and export it as CSV or XML.

## Use the Web UI

Start the local interface:

```bash
vaultlint --ui
```

From a source checkout, run `bun run ui` from the repository root instead. Open `http://127.0.0.1:4173`, then choose your export file or load the sample vault. For the browser workflow, see the [Web UI guide](../apps/site/src/content/docs/guides/web-ui.mdx).

After loading a vault, use these sections:

Each section opens with a heading that names it and summarizes what it does, and a "Local-first workspace" note reminds you that nothing leaves your browser unless you start an opt-in network action.

- **Items**: Search, filter, sort, add, edit, delete, or select entries for bulk actions.
- **Review**: Run vault checks, inspect duplicate groups, and review password and URI findings (tabs: _Vault checks_, _Duplicates_, _Security & links_).
- **Organize**: Preview regex edits, normalize names and URIs, and apply domain mappings (_Batch & domains_). The same section holds _Merge vault_, where you load a second unencrypted export to preview match confidence, possible matches, field differences, and new entries, choose values for each conflict, and export a sanitized decision report, and _FIDO import_ for unencrypted Aegis JSON exports.
- **AI**: Run optional AI folder, URI, and pattern suggestions. Only item names and hostnames are sent, and only when you start an action.
- **Activity**: Review changes made during the session and export a sanitized report.

Use **Undo** (`Ctrl+Z`) and **Redo** (`Ctrl+Y`) to review edits. Choose an export format in the header and select **Export** to download the result. Known export data-loss warnings appear before exporting. Expand **Compare all supported export formats** to export and re-import the vault in memory for each format and inspect field-level changes. The comparison report contains field names and counts, not vault values. Network checks and AI actions run only when you start them; see the [privacy guide](../apps/site/src/content/docs/security/privacy-policy.mdx) for details.

### Local recovery copy

The Web UI does not store your vault by default. If you want to survive an accidental refresh, turn on **Keep an encrypted local recovery copy** (off by default). Only that on/off choice is remembered in `localStorage`; no vault data is ever written there.

While it is on, the Web UI keeps a recovery copy of the open vault in this browser's IndexedDB. The copy is encrypted with AES-GCM, but the non-extractable key is stored beside the ciphertext because there is no passphrase to derive one from. That keeps the vault out of plain text on disk, yet it does not protect against anyone who can use this browser profile, a malicious browser extension, or script running on the same origin.

Turning the option off deletes the stored copy immediately. The copy also expires after 8 hours without edits, is removed when you clear the vault, is replaced when you load another vault, and can be deleted at any time with **Remove saved session**. The **Resume session** prompt appears only when a recovery copy exists. On a shared or untrusted computer, leave the option off or clear the vault before you leave. Nothing is sent over the network.

## Use the CLI

Install with `npm install -g vaultlint` (Node.js 22.12+; pnpm, Yarn, and Bun work too). From a source checkout, replace `vaultlint` below with `bun start --`.

Run a read-only audit first:

```bash
vaultlint --input vault.json --audit --dry-run
```

Other common commands:

```bash
# List entries with weak passwords; password values are masked
vaultlint --input vault.json --list --filter weak

# Merge duplicates and replace weak or reused passwords in a new file
vaultlint --input vault.json --output vault-clean.json \
  --auto-merge --fix-weak-passwords --fix-reused-passwords

# Preview replacing http:// with https:// in URIs
vaultlint --input vault.json --batch-edit --field uri \
  --pattern '^http://' --replacement 'https://' --dry-run

# Open the guided terminal menu
vaultlint --input vault.json --interactive

# Preview and add entries from a second vault export
vaultlint --input vault.json --merge-input second-vault.csv --output combined.json --dry-run

# Prefer the second export's values on matching entries with conflicting fields
vaultlint --input vault.json --merge-input second-vault.csv --prefer-incoming --output combined.json

# Export lint results for code scanning or CI
vaultlint --input vault.json --lint --sarif vaultlint.sarif

# Fail CI only when lint findings are new relative to a previous SARIF report
vaultlint --input vault.json --lint --sarif current.sarif \
  --sarif-baseline baseline.sarif --fail-on-new

# Write a sanitized migration decision record
vaultlint --input vault.json --merge-input second-vault.csv \
  --migration-report migration-decisions.json --dry-run
```

Run `vaultlint --list-rules` to see every lint rule, its default severity, and whether it can be autofixed. Presets (`recommended`, `strict`, `minimal`) are set with `--ruleset`.

For all flags and examples, see the [CLI reference](../apps/site/src/content/docs/cli/commands.mdx).
