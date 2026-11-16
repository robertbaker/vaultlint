import readline from "readline";

import { AI_PROVIDER_REGISTRY, type AiProviderId } from "@vaultlint/ai";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@vaultlint/brand";
import {
  inferFormatFromOutputPath,
  isValidVaultFormat,
  VAULT_FORMATS,
  type VaultFormatId,
} from "@vaultlint/vault-formats";
import {
  type BatchEditTargetMode,
  type LintPresetName,
  VALID_LINT_PRESETS,
} from "@vaultlint/vault-ops";
import { Command } from "commander";

import pkg from "../package.json";
import { applyBatchEdits } from "./batchService";
import { createCliStyle, isColorSupported, renderBox } from "./cliUi";
import { mergeDuplicates } from "./duplicateService";
import type { VaultEnhancementOptions, VaultFilterType } from "./vaultManager";
import { loadVaultWithMeta, saveVault } from "./vaultService";
import { isVendorCliId, VENDOR_CLI_IDS, type VendorCliId } from "./vendorCli";

export interface CLIOptions extends VaultEnhancementOptions {
  skipConfirmation?: boolean;
  ui?: boolean;
  port?: number;
  interactive?: boolean;
  generatePassword?: number;
  listFormats?: boolean;
  listRules?: boolean;
  listCliProviders?: boolean;
}

let parsedOptions: CLIOptions = {
  input: "vault.json",
};

export function printPrivacyNotice(noColor = false): void {
  const style = createCliStyle(isColorSupported(noColor));
  console.log("");
  console.log(
    renderBox(
      "Privacy & Security Notice",
      [
        "Vault data stays on this machine by default.",
        "Network access is opt-in:",
        `${style.bold("--enable-ai / --ai-*")} sends only item names and hostnames.`,
        "Item positions stay local and are not sent to providers.",
        `use ${style.bold("--ai-provider ollama")} to run AI locally.`,
        `${style.bold("--check-compromised")} sends a 5-character SHA-1 prefix to HIBP.`,
      ],
      style,
      "info",
    ),
  );
  console.log("");
}

const VALID_TARGET_MODES: readonly BatchEditTargetMode[] = ["all", "non-empty", "empty", "clear"];
const VALID_FILTERS: readonly VaultFilterType[] = [
  "weak",
  "reused",
  "duplicate",
  "fido",
  "totp",
  "malformed-uri",
  "no-uri",
];

export function setupCLI(argv: string[] = process.argv): Command {
  const program = new Command();
  program.showSuggestionAfterError(true);

  program
    .name(BRAND_NAME)
    .description(BRAND_DESCRIPTION)
    .version(pkg.version)
    .optionsGroup("Vault files & formats")
    .option("-i, --input <path>", "Path to the vault export file", "vault.json")
    .option("--merge-input <path>", "Merge unique items from a second unencrypted vault export")
    .option("--prefer-incoming", "Use incoming values for matched item fields during --merge-input")
    .option("--migration-report <path>", "Write a sanitized JSON record of migration decisions")
    .option("-o, --output <path>", "Path to save the processed vault file")
    .option("--input-format <format>", "Override auto-detected input vault format")
    .option(
      "--output-format <format>",
      "Target export format (defaults to source format, or inferred from .1pux/.xml)",
    )
    .optionsGroup("Vendor CLI connections")
    .option(
      "--from-cli <provider>",
      `Read the vault from a vendor CLI already logged in (${VENDOR_CLI_IDS.join(", ")}); data stays in memory`,
    )
    .option(
      "--push-to-cli",
      "Push changes back through the vendor CLI (previewed; use with --dry-run to preview only)",
    )
    .option("--list-cli-providers", "List supported vendor CLIs and their import/push support")
    .option("--list-formats", "List all supported password manager vault formats and exit")
    .optionsGroup("Saving & backups")
    .option("--in-place", "Overwrite the input vault file (prompts unless -s is set)")
    .option("--backup", "Create a .bak backup before overwriting an existing output file")
    .optionsGroup("Audit & browse")
    .option(
      "--audit",
      "Run full local vault health audit (duplicates, weak/reused passwords, URIs)",
    )
    .optionsGroup("Lint & policy")
    .option("--lint", "Run rule-based linter (classifies findings into error, warning, hint)")
    .option("--fix", "Automatically apply safe autofixes for enabled lint rules")
    .option(
      "--fix-unsafe",
      "Allow --fix to apply unsafe autofixes (password regeneration, duplicate merge)",
    )
    .option("--ruleset <preset>", `Lint ruleset preset (${VALID_LINT_PRESETS.join(", ")})`)
    .option(
      "--config <path>",
      "Path to lint config file (vaultlint.config.json / .vaultlintrc.json)",
    )
    .option("--rule <spec...>", "Override lint rule severity (<rule-id>=<error|warning|hint|off>)")
    .option("--max-warnings <count>", "Exit non-zero if lint warnings exceed <count>")
    .option("--list-rules", "List all available lint rules, severities, and autofix support")
    .optionsGroup("Vault items")
    .option("--stats", "Display vault statistics and health score")
    .option("--list", "List vault items in a formatted table (passwords masked)")
    .option("--search <query>", "Search vault items by name, username, or URI")
    .option(
      "--filter <type>",
      "Filter listed items (weak, reused, duplicate, fido, totp, malformed-uri, no-uri)",
    )
    .optionsGroup("Cleanup & editing")
    .option(
      "-d, --detect-duplicates",
      "Detect duplicate entries (and merge unless --dry-run/--audit)",
    )
    .option("-m, --auto-merge", "Automatically merge duplicate entries")
    .option(
      "-b, --batch-edit",
      "Perform regex batch editing (requires --pattern and --replacement)",
    )
    .option("--normalize", "Normalize item names (lowercase) and URIs (origin-only)")
    .option("--pattern <regex>", "Regex pattern for batch editing")
    .option("--replacement <text>", "Replacement string for batch editing")
    .option("--field <name>", "Target field for batch editing (name, uri, username, notes)", "name")
    .option(
      "--target-mode <mode>",
      "Target mode for batch editing (all, non-empty, empty, clear)",
      "all",
    )
    .optionsGroup("Imports & domain tools")
    .option("--aegis-import <path>", "Path to unencrypted Aegis JSON export for FIDO key import")
    .option("--domain-mappings <path>", "Path to JSON file with domain mappings")
    .optionsGroup("Password & URI checks")
    .option("--check-weak-passwords", "Detect weak passwords in the vault")
    .option("--fix-weak-passwords", "Replace weak passwords with generated strong passwords")
    .option("--check-reused-passwords", "Detect passwords reused across multiple items")
    .option("--fix-reused-passwords", "Replace reused passwords with unique strong passwords")
    .option("--check-uris", "Audit login URIs for malformed syntax or missing schemes")
    .option("--check-redirects", "Opt-in HTTP reachability check for dead links and redirects")
    .option("--fix-redirects", "Append detected redirect targets to matching items")
    .option("--check-compromised", "Check passwords against HIBP k-anonymity API")
    .option("--validate-mobile-uris", "Validate androidapp:// and iosapp:// URIs")
    .optionsGroup("Opt-in AI")
    .option("--enable-ai", "Enable AI-powered folder categorization")
    .option("--ai-organize", "Use AI to categorize folders and clean up item names")
    .option("--ai-duplicates", "Use AI to detect semantic/brand/domain-alias duplicates")
    .option(
      "--ai-suggest-uris",
      "Suggest missing login URIs with AI for review; does not apply them",
    )
    .option("--ai-hygiene", "Use AI to review naming, folder, and domain patterns")
    .option(
      "--ai-provider <name>",
      "AI provider (openai, anthropic, openrouter, grok, gemini, ollama)",
      "openai",
    )
    .option("--ai-model <model>", "Override default model for the selected AI provider")
    .option("--ai-base-url <url>", "Custom base URL for AI provider (e.g. Ollama host)")
    .option(
      "--ai-api-key <key>",
      "API key for the selected AI provider (visible in process listings; prefer the provider's env var such as OPENAI_API_KEY)",
    )
    .optionsGroup("Output & interface")
    .option("--generate-password [length]", "Generate a strong random password and exit")
    .option("-I, --interactive", "Launch interactive guided CLI menu")
    .option("--export-report <path>", "Export summary report (.json or .md) to file")
    .option("--sarif <path>", "Export lint findings as a sanitized SARIF 2.1.0 report")
    .option(
      "--sarif-baseline <path>",
      "Compare findings with a prior SARIF report using stable fingerprints",
    )
    .option(
      "--fail-on-new",
      "Exit non-zero when the baseline comparison finds new errors or warnings",
    )
    .option("--dry-run", "Preview operations without writing output file")
    .option("-s, --skip-confirmation", "Skip confirmation prompts")
    .option("--json", "Output results as machine-readable JSON")
    .option("-v, --verbose", "Show detailed per-item findings")
    .option("-q, --quiet", "Minimal output")
    .option("--no-color", "Disable ANSI color output")
    .option("--ui", "Launch the local Web UI")
    .option("-p, --port <number>", "Port for the local Web UI server", "4173")
    .addHelpText(
      "after",
      `
Examples:
  $ vaultlint -i vault.json --audit
  $ vaultlint -i vault.json --list --filter weak
  $ vaultlint -i vault.json --search github
  $ vaultlint -i vault.json -o clean.json --fix --dry-run
  $ vaultlint -i vault.json --interactive
  $ vaultlint --from-cli bitwarden --audit
  $ vaultlint --generate-password 20
`,
    );

  program.parse(argv);
  const opts = program.opts();

  const rawGenPw = opts.generatePassword;
  let generatePassword: number | undefined;
  if (rawGenPw === true) {
    generatePassword = 16;
  } else if (typeof rawGenPw === "string") {
    const parsed = Number(rawGenPw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid --generate-password length "${rawGenPw}". Expected a positive integer.`,
      );
    }
    generatePassword = parsed;
  }

  const portValue = Number(opts.port);
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
    throw new Error(`Invalid --port "${String(opts.port)}". Expected an integer from 1 to 65535.`);
  }

  const filterValue = opts.filter as string | undefined;
  if (filterValue && !VALID_FILTERS.includes(filterValue as VaultFilterType)) {
    throw new Error(
      `Invalid --filter value "${filterValue}". Valid options: ${VALID_FILTERS.join(", ")}`,
    );
  }

  const targetModeValue = (opts.targetMode as string | undefined) ?? "all";
  if (!VALID_TARGET_MODES.includes(targetModeValue as BatchEditTargetMode)) {
    throw new Error(
      `Invalid --target-mode value "${targetModeValue}". Valid options: ${VALID_TARGET_MODES.join(", ")}`,
    );
  }

  const aiProviderValue = (opts.aiProvider as string | undefined) ?? "openai";
  if (!Object.hasOwn(AI_PROVIDER_REGISTRY, aiProviderValue)) {
    throw new Error(
      `Invalid --ai-provider value "${aiProviderValue}". Valid options: ${Object.keys(AI_PROVIDER_REGISTRY).join(", ")}`,
    );
  }

  const inputFormatValue = opts.inputFormat as string | undefined;
  if (inputFormatValue && !isValidVaultFormat(inputFormatValue)) {
    throw new Error(
      `Invalid --input-format "${inputFormatValue}". Valid formats: ${VAULT_FORMATS.map((f) => f.id).join(", ")}`,
    );
  }

  const outputFormatValue = opts.outputFormat as string | undefined;
  if (outputFormatValue && !isValidVaultFormat(outputFormatValue)) {
    throw new Error(
      `Invalid --output-format "${outputFormatValue}". Valid formats: ${VAULT_FORMATS.map((f) => f.id).join(", ")}`,
    );
  }

  const rulesetValue = opts.ruleset as string | undefined;
  if (rulesetValue && !VALID_LINT_PRESETS.includes(rulesetValue as LintPresetName)) {
    throw new Error(
      `Invalid --ruleset "${rulesetValue}". Valid presets: ${VALID_LINT_PRESETS.join(", ")}`,
    );
  }

  let maxWarnings: number | undefined;
  if (opts.maxWarnings !== undefined) {
    const parsedMax = Number(opts.maxWarnings);
    if (!Number.isInteger(parsedMax) || parsedMax < 0) {
      throw new Error(
        `Invalid --max-warnings "${String(opts.maxWarnings)}". Expected non-negative integer.`,
      );
    }
    maxWarnings = parsedMax;
  }

  if (opts.sarifBaseline && !opts.sarif) {
    throw new Error("--sarif-baseline requires --sarif <path>.");
  }
  if (opts.failOnNew && !opts.sarifBaseline) {
    throw new Error("--fail-on-new requires --sarif-baseline <path>.");
  }
  if (opts.migrationReport && !opts.mergeInput) {
    throw new Error("--migration-report requires --merge-input <path>.");
  }

  if (!opts.batchEdit) {
    const stray = [
      ["--pattern", opts.pattern !== undefined],
      ["--replacement", opts.replacement !== undefined],
      ["--field", program.getOptionValueSource("field") === "cli"],
      ["--target-mode", program.getOptionValueSource("targetMode") === "cli"],
    ]
      .filter(([, given]) => given)
      .map(([flag]) => flag as string);
    if (stray.length > 0) {
      throw new Error(`${stray.join(", ")} only take effect with --batch-edit; add --batch-edit.`);
    }
  }

  if (opts.fixUnsafe && !opts.fix) {
    throw new Error("--fix-unsafe only takes effect with --fix; add --fix.");
  }

  if (typeof opts.exportReport === "string" && !/\.(?:json|md)$/i.test(opts.exportReport)) {
    throw new Error(
      `--export-report must end in .json or .md (got "${opts.exportReport}"); the extension selects the report format.`,
    );
  }

  const fromCliValue = opts.fromCli as string | undefined;
  if (fromCliValue && !isVendorCliId(fromCliValue)) {
    throw new Error(
      `Invalid --from-cli "${fromCliValue}". Valid providers: ${VENDOR_CLI_IDS.join(", ")}`,
    );
  }

  parsedOptions = {
    input: opts.input,
    fromCli: fromCliValue as VendorCliId | undefined,
    pushToCli: Boolean(opts.pushToCli),
    listCliProviders: Boolean(opts.listCliProviders),
    output: opts.output,
    inputFormat: inputFormatValue as VaultFormatId | undefined,
    mergeInput: opts.mergeInput as string | undefined,
    preferIncoming: Boolean(opts.preferIncoming),
    migrationReport: opts.migrationReport as string | undefined,
    outputFormat: outputFormatValue as VaultFormatId | undefined,
    listFormats: Boolean(opts.listFormats),
    listRules: Boolean(opts.listRules),
    inPlace: Boolean(opts.inPlace),
    backup: Boolean(opts.backup),
    audit: Boolean(opts.audit),
    lint: Boolean(opts.lint),
    fix: Boolean(opts.fix),
    fixUnsafe: Boolean(opts.fixUnsafe),
    ruleset: rulesetValue as LintPresetName | undefined,
    config: opts.config as string | undefined,
    ruleOverrides: Array.isArray(opts.rule) ? (opts.rule as string[]) : undefined,
    maxWarnings,
    stats: Boolean(opts.stats),
    list: Boolean(opts.list),
    search: opts.search,
    filter: filterValue as VaultFilterType | undefined,
    detectDuplicates: Boolean(opts.detectDuplicates),
    autoMerge: Boolean(opts.autoMerge),
    batchEdit: Boolean(opts.batchEdit),
    normalize: Boolean(opts.normalize),
    pattern: opts.pattern,
    replacement: opts.replacement,
    field: opts.field,
    targetMode: targetModeValue as BatchEditTargetMode,
    aegisImport: opts.aegisImport,
    domainMappings: opts.domainMappings,
    checkWeakPasswords: Boolean(opts.checkWeakPasswords),
    fixWeakPasswords: Boolean(opts.fixWeakPasswords),
    checkReusedPasswords: Boolean(opts.checkReusedPasswords),
    fixReusedPasswords: Boolean(opts.fixReusedPasswords),
    checkUris: Boolean(opts.checkUris),
    checkRedirects: Boolean(opts.checkRedirects),
    fixRedirects: Boolean(opts.fixRedirects),
    checkCompromised: Boolean(opts.checkCompromised),
    validateMobileUris: Boolean(opts.validateMobileUris),
    enableAI: Boolean(opts.enableAi),
    aiOrganize: Boolean(opts.aiOrganize),
    aiDuplicates: Boolean(opts.aiDuplicates),
    aiSuggestUris: Boolean(opts.aiSuggestUris),
    aiHygiene: Boolean(opts.aiHygiene),
    aiProvider: aiProviderValue as AiProviderId,
    aiModel: opts.aiModel,
    aiBaseUrl: opts.aiBaseUrl,
    aiApiKey: opts.aiApiKey,
    generatePassword,
    interactive: Boolean(opts.interactive),
    exportReport: opts.exportReport,
    sarif: opts.sarif,
    sarifBaseline: opts.sarifBaseline as string | undefined,
    failOnNew: Boolean(opts.failOnNew),
    dryRun: Boolean(opts.dryRun),
    skipConfirmation: Boolean(opts.skipConfirmation),
    json: Boolean(opts.json),
    verbose: Boolean(opts.verbose),
    quiet: Boolean(opts.quiet),
    noColor: opts.color === false,
    ui: Boolean(opts.ui),
    port: portValue,
  };

  return program;
}

export function getOptions(): CLIOptions {
  return parsedOptions;
}

async function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

/** Execute CLI non-interactive or interactive quick mode. */
export async function runCLI(argv: string[] = process.argv): Promise<void> {
  setupCLI(argv);
  const opts = getOptions();
  // Fail before loading anything: batch edits are never implied, and never guess a pattern.
  if (opts.batchEdit && (opts.pattern === undefined || opts.replacement === undefined)) {
    throw new Error("--batch-edit requires both --pattern <regex> and --replacement <text>.");
  }
  if (!opts.json && !opts.quiet) {
    printPrivacyNotice(opts.noColor);
  }

  const parsed = await loadVaultWithMeta(opts.input, undefined, { format: opts.inputFormat });
  const vaultData = parsed.vault;

  if (opts.autoMerge) {
    console.log("Auto-merging duplicates...");
    mergeDuplicates(vaultData);
  }

  if (opts.batchEdit) {
    console.log("Performing batch editing...");
    await applyBatchEdits(
      vaultData,
      opts.pattern as string,
      opts.replacement as string,
      opts.field ?? "name",
      opts.targetMode ?? "all",
    );
  }

  const outputPath = opts.output || opts.input;
  if (!opts.dryRun) {
    const shouldSave = opts.skipConfirmation
      ? true
      : await confirmPrompt(`Save changes to "${outputPath}"?`);

    if (shouldSave) {
      const targetFormat =
        opts.outputFormat ?? inferFormatFromOutputPath(outputPath, parsed.format);
      await saveVault(vaultData, outputPath, undefined, {
        format: targetFormat,
        rawMeta: parsed.rawMeta,
      });
      console.log(`Saved vault to ${outputPath}`);
    } else {
      console.log("Save cancelled.");
    }
  }
}
