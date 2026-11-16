import fs from "fs";
import { createHash } from "node:crypto";
import path from "path";

import {
  AI_PROVIDER_REGISTRY,
  type AiHygieneFinding,
  type AiProviderId,
  type AiUriSuggestion,
  buildAiItemRefs,
  isNonLocalAiEndpoint,
} from "@vaultlint/ai";
import {
  inferFormatFromOutputPath,
  parseVault,
  type VaultFormatId,
} from "@vaultlint/vault-formats";
import {
  applyLintFixes,
  buildDuplicateGroupFromIds,
  buildVaultMigrationDecisionReport,
  LINT_RULES,
  lintVault,
  mergeVaultMigration,
  previewVaultMigration,
  parseLintConfigJson,
  parseRuleOverride,
  redactUriCredentials,
  type BatchEditTargetMode,
  type LintPresetName,
  type LintResult,
  type VaultMigrationDecisionReport,
  type VaultLintConfig,
} from "@vaultlint/vault-ops";
import {
  extractDomainParts,
  getSafeUriDisplayLabel,
  getUriString,
  hasFidoCredentials,
} from "@vaultlint/vault-schema";

import { handleAegisImport } from "./aegisManager";
import {
  analyzeHygieneWithAi,
  categorizeVaultWithAi,
  detectDuplicatesWithAi,
  organizeVaultWithAi,
  suggestUrisWithAi,
} from "./aiService";
import { applyBatchEdits, previewBatchEdits, runBatchEditing } from "./batchService";
import {
  type CliStyle,
  createCliStyle,
  isColorSupported,
  loadClack,
  renderProgressBar,
  renderBox,
  renderSection,
  renderTable,
  startProgress,
  startSpinner,
} from "./cliUi";
import { loadDomainMappings, applyDomainMappings } from "./domainMappingService";
import { findDuplicateGroups, runDuplicateDetection } from "./duplicateService";
import { assertSafeReportTarget, isSamePath, readUtf8Text, writeReportFile } from "./safeWrite";
import { addToHistory } from "./undoRedoManager";
import {
  loadVault,
  loadVaultWithMeta,
  saveVault,
  type SaveVaultOptions,
  findWeakPasswordItems,
  batchUpdateWeakPasswords,
  findReusedPasswordGroups,
  batchUpdateReusedPasswords,
  findMalformedUris,
  computeVaultHealth,
  detectCompromisedPasswords,
  detectAndValidateMobileAppUris,
  checkUriReachability,
  applyRedirectUpdates,
  isWeakPassword,
  type VaultData,
  type VaultHealthSummary,
  type VaultItem,
} from "./vaultService";
import {
  describeVendorCliSupport,
  fetchFromVendorCli,
  nodeCommandRunner,
  VENDOR_CLI_PROVIDERS,
  type CommandRunner,
  type VendorCliId,
} from "./vendorCli";

export type VaultFilterType =
  | "weak"
  | "reused"
  | "duplicate"
  | "fido"
  | "totp"
  | "malformed-uri"
  | "no-uri";

export interface VaultEnhancementOptions {
  input: string;
  /** Read the vault from a vendor CLI (in memory) instead of from `input`. */
  fromCli?: VendorCliId;
  /** Push the resulting changes back through the vendor CLI (dry-run unless confirmed). */
  pushToCli?: boolean;
  /** Test seam: replaces the real process runner. */
  vendorRunner?: CommandRunner;
  output?: string;
  inputFormat?: VaultFormatId;
  mergeInput?: string;
  preferIncoming?: boolean;
  migrationReport?: string;
  outputFormat?: VaultFormatId;
  inPlace?: boolean;
  backup?: boolean;
  skipConfirmation?: boolean;
  detectDuplicates?: boolean;
  autoMerge?: boolean;
  aegisImport?: string;
  enableAI?: boolean;
  batchEdit?: boolean;
  normalize?: boolean;
  pattern?: string;
  replacement?: string;
  field?: string;
  targetMode?: BatchEditTargetMode;
  domainMappings?: string;
  checkWeakPasswords?: boolean;
  fixWeakPasswords?: boolean;
  checkReusedPasswords?: boolean;
  fixReusedPasswords?: boolean;
  checkUris?: boolean;
  checkRedirects?: boolean;
  fixRedirects?: boolean;
  checkCompromised?: boolean;
  validateMobileUris?: boolean;
  aiOrganize?: boolean;
  aiDuplicates?: boolean;
  aiSuggestUris?: boolean;
  aiHygiene?: boolean;
  aiProvider?: AiProviderId;
  aiModel?: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  audit?: boolean;
  lint?: boolean;
  fix?: boolean;
  fixUnsafe?: boolean;
  ruleset?: LintPresetName;
  config?: string;
  ruleOverrides?: string[];
  maxWarnings?: number;
  stats?: boolean;
  list?: boolean;
  search?: string;
  filter?: VaultFilterType;
  exportReport?: string;
  sarif?: string;
  sarifBaseline?: string;
  failOnNew?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
  noColor?: boolean;
}

export interface EnhancementReport {
  sourceFormat?: VaultFormatId;
  outputFormat?: VaultFormatId;
  totalItemsBefore: number;
  totalItemsAfter: number;
  duplicatesFound: number;
  duplicatesMerged: number;
  batchEditsApplied: number;
  domainMappingsApplied: number;
  weakPasswordsFound: number;
  weakPasswordsUpdated: number;
  reusedPasswordGroups: number;
  reusedPasswordsFound: number;
  reusedPasswordsUpdated: number;
  malformedUrisFound: number;
  redirectsFound: number;
  deadLinksFound: number;
  redirectsApplied: number;
  compromisedPasswordsFound: number;
  validMobileUris: string[];
  invalidMobileUris: string[];
  healthScoreBefore: number;
  healthScoreAfter: number;
  healthSummary?: VaultHealthSummary;
  aiRenamedCount?: number;
  aiDuplicatesFound?: number;
  aiUriSuggestions?: AiUriSuggestion[];
  aiHygieneFindings?: AiHygieneFinding[];
  aiHygieneDisclaimer?: string;
  lintFixesApplied?: number;
  lint?: LintResult;
  migrationItemsAdded?: number;
  migrationItemsUpdated?: number;
  migrationMatches?: number;
  migrationConflicts?: number;
  migrationDecisionReport?: VaultMigrationDecisionReport;
  sarifNewFindingCount?: number;
  sarifNewErrorCount?: number;
  sarifNewWarningCount?: number;
  /**
   * Which optional checks actually ran. A counter of 0 for a check that did not run means "not
   * checked", not "none found". Absent on reports built outside the pipeline.
   */
  checksRun?: {
    weakPasswords: boolean;
    reusedPasswords: boolean;
    malformedUris: boolean;
    compromised: boolean;
  };
}

const DEFAULT_CONFIG_FILES = ["vaultlint.config.json", ".vaultlintrc.json"];

/**
 * Resolve lint configuration from explicit `--config`, CWD config file, `--ruleset`, and `--rule`
 * overrides.
 */
export function loadEffectiveLintConfig(options: VaultEnhancementOptions): VaultLintConfig {
  let config: VaultLintConfig = {};
  const explicitPath = options.config;
  const discoveredPath = explicitPath
    ? explicitPath
    : DEFAULT_CONFIG_FILES.map((f) => path.resolve(process.cwd(), f)).find((p) => fs.existsSync(p));

  if (explicitPath && !fs.existsSync(explicitPath)) {
    throw new Error(`Lint config file not found: ${explicitPath}`);
  }
  if (discoveredPath) {
    config = parseLintConfigJson(readUtf8Text(discoveredPath));
  }
  if (options.ruleset) {
    config.extends = options.ruleset;
  }
  if (options.ruleOverrides && options.ruleOverrides.length > 0) {
    config.rules = { ...config.rules };
    for (const spec of options.ruleOverrides) {
      const { ruleId, severity } = parseRuleOverride(spec);
      config.rules[ruleId] = severity;
    }
  }
  return config;
}

export async function processVault(filePath: string): Promise<VaultData> {
  console.log("Loading vault from:", filePath);
  const vaultData = await loadVault(filePath);
  console.log(`Vault loaded successfully (${vaultData.items.length} item(s)).`);
  return vaultData;
}

export async function saveProcessedVault(
  vaultData: VaultData,
  outputPath: string,
  options?: SaveVaultOptions,
): Promise<void> {
  console.log("Saving processed vault to:", outputPath);
  await saveVault(vaultData, outputPath, undefined, options);
  console.log("Vault saved successfully.");
}

function getItemIssueBadges(
  item: VaultItem,
  reusedSet: Set<VaultItem>,
  duplicateSet: Set<VaultItem>,
  malformedSet: Set<VaultItem>,
  style: CliStyle,
): string {
  const badges: string[] = [];
  if (item.login?.password && isWeakPassword(item.login.password)) {
    badges.push(style.yellow("WEAK"));
  }
  if (reusedSet.has(item)) {
    badges.push(style.yellow("REUSED"));
  }
  if (duplicateSet.has(item)) {
    badges.push(style.cyan("DUP"));
  }
  if (malformedSet.has(item)) {
    badges.push(style.red("BAD-URI"));
  }
  if (hasFidoCredentials(item)) {
    badges.push(style.green("FIDO"));
  }
  if (item.login?.totp) {
    badges.push(style.blue("TOTP"));
  }
  return badges.length > 0 ? badges.join(" ") : style.dim("OK");
}

/** Filter and search vault items for `--list`, `--search`, or `--filter`. */
export function filterVaultItems(
  vaultData: VaultData,
  search?: string,
  filter?: VaultFilterType,
): {
  items: VaultItem[];
  reusedSet: Set<VaultItem>;
  duplicateSet: Set<VaultItem>;
  malformedSet: Set<VaultItem>;
} {
  const reusedSet = new Set<VaultItem>();
  for (const g of findReusedPasswordGroups(vaultData)) {
    for (const item of g.items) reusedSet.add(item);
  }

  const duplicateSet = new Set<VaultItem>();
  for (const g of findDuplicateGroups(vaultData)) {
    for (const item of g.items) duplicateSet.add(item);
  }

  const malformedSet = new Set<VaultItem>();
  for (const issue of findMalformedUris(vaultData)) {
    malformedSet.add(issue.item);
  }

  const query = search?.trim().toLowerCase();
  const items = vaultData.items.filter((item) => {
    if (filter === "weak" && !(item.login?.password && isWeakPassword(item.login.password))) {
      return false;
    }
    if (filter === "reused" && !reusedSet.has(item)) return false;
    if (filter === "duplicate" && !duplicateSet.has(item)) return false;
    if (filter === "malformed-uri" && !malformedSet.has(item)) return false;
    if (filter === "no-uri" && (item.login?.uris?.length ?? 0) > 0) return false;
    if (filter === "fido" && !hasFidoCredentials(item)) return false;
    if (filter === "totp" && !item.login?.totp) return false;

    if (query) {
      const nameMatch = (item.name ?? "").toLowerCase().includes(query);
      const userMatch = (item.login?.username ?? "").toLowerCase().includes(query);
      const uriMatch = (item.login?.uris ?? []).some((u) =>
        getUriString(u).toLowerCase().includes(query),
      );
      return nameMatch || userMatch || uriMatch;
    }
    return true;
  });

  return { items, reusedSet, duplicateSet, malformedSet };
}

export function renderVaultItemsTable(
  vaultData: VaultData,
  options: Pick<VaultEnhancementOptions, "search" | "filter">,
  style: CliStyle,
): string {
  const { items, reusedSet, duplicateSet, malformedSet } = filterVaultItems(
    vaultData,
    options.search,
    options.filter,
  );

  if (items.length === 0) {
    return style.dim("No matching vault items found.");
  }

  const rows = items.slice(0, 100).map((item, idx) => {
    const uri = item.login?.uris?.[0]
      ? redactUriCredentials(getUriString(item.login.uris[0]))
      : "—";
    const status = getItemIssueBadges(item, reusedSet, duplicateSet, malformedSet, style);
    return [
      String(idx + 1),
      item.name || style.dim("(unnamed)"),
      item.login?.username || style.dim("—"),
      uri,
      status,
    ];
  });

  const table = renderTable(["#", "Name", "Username", "Primary URI", "Status"], rows, {
    maxColWidth: 34,
    alignRight: [0],
    style,
  });

  if (items.length > 100) {
    return `${table}\n${style.dim(`… showing 100 of ${items.length} matching items`)}`;
  }
  return `${table}\n${style.dim(`Showing ${items.length} item(s)`)}`;
}

const BATCH_EDIT_FIELDS = ["name", "uri", "username", "notes"];

/** Files a report/SARIF output must never overwrite (inputs, configs, baselines, vault output). */
function protectedReportPaths(options: VaultEnhancementOptions) {
  return [
    { path: options.fromCli ? undefined : options.input, label: "input vault" },
    { path: options.mergeInput, label: "merge input vault" },
    { path: options.aegisImport, label: "Aegis import file" },
    { path: options.domainMappings, label: "domain mappings file" },
    { path: options.config, label: "lint config file" },
    { path: options.sarifBaseline, label: "SARIF baseline" },
    {
      path: options.output || (options.inPlace ? options.input : undefined),
      label: "vault output",
    },
  ];
}

/** Validate every report destination up front so a bad path fails before any work or network use. */
function validateReportTargets(options: VaultEnhancementOptions): void {
  const reports = [
    { path: options.migrationReport, label: "migration report" },
    { path: options.exportReport, label: "summary report" },
    { path: options.sarif, label: "SARIF report" },
  ];
  for (const report of reports) {
    if (!report.path) continue;
    const others = reports.filter((other) => other !== report);
    assertSafeReportTarget(report.path, report.label, [
      ...protectedReportPaths(options),
      ...others,
    ]);
  }
}

/**
 * Process exit code for lint-related gating.
 *
 * - `--fail-on-new` fails only on findings new relative to the SARIF baseline, so existing findings
 *   do not fail the run.
 * - Otherwise `--lint` fails on any error-severity finding.
 * - `--max-warnings` fails when warnings exceed the budget, whenever the linter ran.
 */
export function getLintExitCode(
  options: Pick<VaultEnhancementOptions, "lint" | "failOnNew" | "maxWarnings">,
  report: Pick<EnhancementReport, "lint" | "sarifNewErrorCount" | "sarifNewWarningCount">,
): 0 | 1 {
  if (
    options.failOnNew &&
    ((report.sarifNewErrorCount ?? 0) > 0 || (report.sarifNewWarningCount ?? 0) > 0)
  ) {
    return 1;
  }
  if (!report.lint) return 0;
  if (options.lint && !options.failOnNew && report.lint.counts.error > 0) return 1;
  if (options.maxWarnings !== undefined && report.lint.counts.warning > options.maxWarnings) {
    return 1;
  }
  return 0;
}

let writeStdout: (...args: unknown[]) => void = (...args) => console.log(...args);

/**
 * Run the enhancement pipeline. With `--json` every incidental progress line from helper services
 * (which log with `console.log`) is routed to stderr, and with `--quiet` it is dropped, so stdout
 * carries only the machine-readable payload.
 */
export async function runVaultEnhancement(
  options: VaultEnhancementOptions,
): Promise<EnhancementReport> {
  if (!options.json && !options.quiet) return runVaultEnhancementInner(options);
  const originalLog = console.log;
  const originalInfo = console.info;
  const previousWriter = writeStdout;
  const sink = options.json ? (...args: unknown[]) => console.error(...args) : () => {};
  writeStdout = (...args) => originalLog.apply(console, args);
  console.log = sink;
  console.info = sink;
  try {
    return await runVaultEnhancementInner(options);
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    writeStdout = previousWriter;
  }
}

async function runVaultEnhancementInner(
  options: VaultEnhancementOptions,
): Promise<EnhancementReport> {
  if (!options.input) {
    throw new Error("Input vault file path (--input) is required.");
  }

  const style = createCliStyle(!options.json && isColorSupported(options.noColor));
  const quiet = Boolean(options.quiet || options.json);
  const log = (msg: string) => {
    if (!quiet) console.log(msg);
  };

  if (options.pushToCli && !options.fromCli) {
    throw new Error("--push-to-cli requires --from-cli <provider>.");
  }
  if (options.preferIncoming && !options.mergeInput) {
    throw new Error("--prefer-incoming requires --merge-input <path>.");
  }
  if (options.fromCli && options.pushToCli) {
    // Fail before reading the live vault when the provider can never be pushed to.
    const provider = VENDOR_CLI_PROVIDERS[options.fromCli];
    if (!describeVendorCliSupport(provider).write) {
      throw new Error(
        provider.unsupportedReason?.write ?? `${provider.displayName} does not support push.`,
      );
    }
  }
  if (options.fromCli && options.inPlace) {
    // `input` is only a default path here; overwriting it would clobber an unrelated local file.
    throw new Error("--in-place cannot be used with --from-cli; pass --output <path> instead.");
  }

  if (options.batchEdit && (options.pattern === undefined || options.replacement === undefined)) {
    throw new Error(
      "--batch-edit requires both --pattern <regex> and --replacement <text> (use --normalize to lowercase names and reduce URIs to origins).",
    );
  }
  if (options.batchEdit && options.field && !BATCH_EDIT_FIELDS.includes(options.field)) {
    throw new Error(
      `Invalid --field "${options.field}". Valid fields: ${BATCH_EDIT_FIELDS.join(", ")}`,
    );
  }
  validateReportTargets(options);
  if (options.sarifBaseline && options.sarif) {
    if (path.resolve(options.sarifBaseline) === path.resolve(options.sarif)) {
      throw new Error("--sarif and --sarif-baseline must use different paths.");
    }
  }
  // Read the baseline before touching any vault, output file, or live vendor vault.
  const sarifBaselineFingerprints =
    options.sarif && options.sarifBaseline
      ? readSarifBaselineFingerprints(options.sarifBaseline)
      : new Set<string>();
  if (options.aiApiKey) {
    const envVar = AI_PROVIDER_REGISTRY[options.aiProvider ?? "openai"]?.envVarName;
    console.warn(
      `Warning: --ai-api-key puts the API key in this process's command line, where other local users and shell history can see it. Prefer the ${envVar ?? "provider"} environment variable.`,
    );
  }

  let parsed;
  let vendor: Awaited<ReturnType<typeof fetchFromVendorCli>> | undefined;
  if (options.fromCli) {
    log(style.dim(`Reading vault from the ${options.fromCli} CLI (in memory)...`));
    vendor = await fetchFromVendorCli(options.fromCli, options.vendorRunner);
    parsed = parseVault(vendor.content, { format: vendor.format });
  } else {
    log(style.dim(`Loading vault from ${options.input}...`));
    parsed = await loadVaultWithMeta(options.input, undefined, {
      format: options.inputFormat,
    });
  }
  const vaultData = parsed.vault;
  const vendorOriginal = options.pushToCli ? structuredClone(vaultData) : undefined;
  addToHistory(vaultData);
  log(
    `${style.green("✔")} Loaded ${style.bold(String(vaultData.items.length))} item(s) ${style.dim(`(${parsed.formatName})`)}`,
  );

  if (vendor && vaultData.items.length === 0) {
    console.warn(
      `Warning: the ${options.fromCli} CLI returned an empty vault. Check that you are logged in to the right account before writing --output or pushing changes.`,
    );
  }

  const healthBefore = computeVaultHealth(vaultData);

  const report: EnhancementReport = {
    sourceFormat: parsed.format,
    totalItemsBefore: vaultData.items.length,
    totalItemsAfter: vaultData.items.length,
    duplicatesFound: healthBefore.duplicateItemCount,
    duplicatesMerged: 0,
    batchEditsApplied: 0,
    domainMappingsApplied: 0,
    weakPasswordsFound: 0,
    weakPasswordsUpdated: 0,
    reusedPasswordGroups: 0,
    reusedPasswordsFound: 0,
    reusedPasswordsUpdated: 0,
    malformedUrisFound: 0,
    redirectsFound: 0,
    deadLinksFound: 0,
    redirectsApplied: 0,
    compromisedPasswordsFound: 0,
    validMobileUris: [],
    invalidMobileUris: [],
    healthScoreBefore: healthBefore.healthScore,
    healthScoreAfter: healthBefore.healthScore,
    checksRun: {
      weakPasswords: false,
      reusedPasswords: false,
      malformedUris: false,
      compromised: false,
    },
  };

  if (options.mergeInput) {
    const incoming = await loadVaultWithMeta(options.mergeInput);
    const before = vaultData.items.length;
    const itemsBeforeMerge = structuredClone(vaultData.items);
    const preview = previewVaultMigration(vaultData, incoming.vault);
    const merged = mergeVaultMigration(
      vaultData,
      incoming.vault,
      options.preferIncoming ? "incoming" : "current",
    );
    vaultData.items = merged.items;
    report.migrationItemsAdded = merged.items.length - before;
    report.migrationMatches = preview.matches.length;
    report.migrationConflicts = preview.matches.filter(
      (match) => match.conflicts.length > 0,
    ).length;
    report.migrationItemsUpdated = merged.items
      .slice(0, before)
      .filter(
        (item, index) => JSON.stringify(item) !== JSON.stringify(itemsBeforeMerge[index]),
      ).length;
    const decisionOptions = {
      defaultPreference: options.preferIncoming ? ("incoming" as const) : ("current" as const),
    };
    report.migrationDecisionReport = buildVaultMigrationDecisionReport(preview, decisionOptions);
    if (options.migrationReport) {
      writeReportFile(
        options.migrationReport,
        JSON.stringify(report.migrationDecisionReport, null, 2),
        "migration report",
        [...protectedReportPaths(options), { path: options.exportReport, label: "summary report" }],
      );
      log(
        `${style.green("✔")} Sanitized migration decision report exported to ${options.migrationReport}`,
      );
    }
    log(
      `${style.green("✔")} Migration: ${report.migrationItemsAdded} new item(s), ${report.migrationMatches} matched, ${report.migrationConflicts} matched item(s) with field conflicts. ${options.preferIncoming ? "Incoming values were preferred for conflicts." : "Current values were kept for conflicts."}`,
    );
  }

  const runAudit = Boolean(options.audit);

  // 1. Duplicates
  if (options.detectDuplicates || options.autoMerge || runAudit) {
    const dupGroups = findDuplicateGroups(vaultData);
    report.duplicatesFound = dupGroups.reduce((sum, g) => sum + (g.items.length - 1), 0);

    const shouldMerge =
      Boolean(options.autoMerge) ||
      (Boolean(options.detectDuplicates) && !options.dryRun && !runAudit);

    if (shouldMerge && !options.dryRun) {
      report.duplicatesMerged = await runDuplicateDetection(vaultData);
    } else if (!quiet) {
      if (dupGroups.length === 0) {
        log(`${style.green("✔")} No duplicate items found.`);
      } else {
        log(
          `${style.yellow("⚠")} Found ${style.bold(String(dupGroups.length))} duplicate group(s) (${report.duplicatesFound} extra item(s))${options.dryRun ? style.dim(" [dry-run]") : ""}.`,
        );
        if (options.verbose || runAudit) {
          const rows = dupGroups.slice(0, 20).map((g) => {
            const flags: string[] = [];
            if (g.conflicts.hasDifferentUsernames) flags.push("diff users");
            if (g.conflicts.hasDifferentPasswords) flags.push("diff passwords");
            if (g.conflicts.hasDifferentSubdomains) flags.push("diff subdomains");
            return [
              g.name,
              String(g.items.length),
              g.items.map((i) => i.login?.username || "—").join(", "),
              flags.length > 0 ? flags.join(", ") : "safe",
            ];
          });
          log(
            renderTable(["Name", "Count", "Usernames", "Conflicts"], rows, {
              alignRight: [1],
              style,
            }),
          );
        }
      }
    }
  }

  // 2. Aegis FIDO import
  if (options.aegisImport) {
    if (options.dryRun) {
      log(style.dim("Skipping Aegis import mutation in --dry-run mode."));
    } else {
      await handleAegisImport(options.aegisImport, vaultData);
    }
  }

  // 3. Domain mappings
  if (options.domainMappings) {
    const mappings = loadDomainMappings(options.domainMappings);
    if (options.dryRun) {
      log(style.dim(`Loaded ${Object.keys(mappings).length} domain mapping(s) [dry-run].`));
    } else {
      report.domainMappingsApplied = applyDomainMappings(vaultData, mappings);
      log(`${style.green("✔")} Applied ${report.domainMappingsApplied} domain mapping(s).`);
    }
  }

  // 4. Batch edit (pattern/replacement were validated up front; never falls back to normalizing)
  if (options.batchEdit && options.pattern !== undefined && options.replacement !== undefined) {
    const { pattern, replacement } = options;
    const targetField = options.field || "name";
    const targetMode = options.targetMode || "all";
    if (options.dryRun) {
      const previews = previewBatchEdits(vaultData, pattern, replacement, targetField, targetMode);
      log(
        `${style.cyan("•")} Batch edit preview (${targetField}, mode=${targetMode}): ${style.bold(String(previews.length))} match(es) ${style.dim("[dry-run]")}`,
      );
      if (!quiet && previews.length > 0) {
        const rows = previews.slice(0, 20).map((p) => [p.itemName, p.before, p.after]);
        log(renderTable(["Item", "Before", "After"], rows, { maxColWidth: 32, style }));
      }
    } else {
      report.batchEditsApplied = await applyBatchEdits(
        vaultData,
        pattern,
        replacement,
        targetField,
        targetMode,
      );
    }
  }

  // 4b. Explicit name & URI normalization
  if (options.normalize) {
    if (options.dryRun) {
      log(style.dim("Normalize names and URIs skipped in --dry-run mode."));
    } else {
      await runBatchEditing(vaultData);
      log(`${style.green("✔")} Normalized item names and URIs.`);
    }
  }

  // 5. Weak passwords
  if (options.checkWeakPasswords || options.fixWeakPasswords || runAudit) {
    const weakItems = findWeakPasswordItems(vaultData);
    report.weakPasswordsFound = weakItems.length;
    report.checksRun!.weakPasswords = true;
    if (!quiet) {
      if (weakItems.length === 0) {
        log(`${style.green("✔")} No weak passwords detected.`);
      } else {
        log(
          `${style.yellow("⚠")} Weak passwords detected: ${style.bold(String(weakItems.length))}`,
        );
        if (options.verbose) {
          const rows = weakItems
            .slice(0, 20)
            .map((item) => [
              item.name || "(unnamed)",
              item.login?.username || "—",
              String(item.login?.password?.length ?? 0),
            ]);
          log(renderTable(["Item", "Username", "Length"], rows, { alignRight: [2], style }));
        }
      }
    }
    if (options.fixWeakPasswords && weakItems.length > 0 && !options.dryRun) {
      report.weakPasswordsUpdated = batchUpdateWeakPasswords(vaultData);
      log(`${style.green("✔")} Updated ${report.weakPasswordsUpdated} weak password(s).`);
    }
  }

  // 6. Reused passwords
  if (options.checkReusedPasswords || options.fixReusedPasswords || runAudit) {
    const reusedGroups = findReusedPasswordGroups(vaultData);
    report.reusedPasswordGroups = reusedGroups.length;
    report.checksRun!.reusedPasswords = true;
    report.reusedPasswordsFound = reusedGroups.reduce((sum, g) => sum + g.count, 0);

    if (!quiet) {
      if (reusedGroups.length === 0) {
        log(`${style.green("✔")} No reused passwords detected.`);
      } else {
        log(
          `${style.yellow("⚠")} Reused passwords: ${style.bold(String(reusedGroups.length))} group(s) affecting ${report.reusedPasswordsFound} item(s).`,
        );
        if (options.verbose || runAudit) {
          const rows = reusedGroups
            .slice(0, 15)
            .map((g, idx) => [
              `Group ${idx + 1}`,
              String(g.count),
              g.items.map((i) => i.name || "(unnamed)").join(", "),
            ]);
          log(
            renderTable(["Group", "Items", "Affected Entries"], rows, { alignRight: [1], style }),
          );
        }
      }
    }

    if (options.fixReusedPasswords && reusedGroups.length > 0 && !options.dryRun) {
      report.reusedPasswordsUpdated = batchUpdateReusedPasswords(vaultData);
      log(`${style.green("✔")} Regenerated ${report.reusedPasswordsUpdated} reused password(s).`);
    }
  }

  // 7. Malformed URIs
  if (options.checkUris || runAudit) {
    const uriIssues = findMalformedUris(vaultData);
    report.malformedUrisFound = uriIssues.length;
    report.checksRun!.malformedUris = true;
    if (!quiet) {
      if (uriIssues.length === 0) {
        log(`${style.green("✔")} All login URIs are well-formed.`);
      } else {
        log(`${style.yellow("⚠")} Malformed URIs found: ${style.bold(String(uriIssues.length))}`);
        if (options.verbose || runAudit) {
          const rows = uriIssues
            .slice(0, 20)
            .map((u) => [u.item.name || "(unnamed)", getSafeUriDisplayLabel(u.uri), u.reason]);
          log(renderTable(["Item", "URI", "Issue"], rows, { maxColWidth: 34, style }));
        }
      }
    }
  }

  // 8. Compromised passwords (HIBP)
  if (options.checkCompromised) {
    const pwCount = vaultData.items.filter((i) => Boolean(i.login?.password)).length;
    const progress = await startProgress("Checking passwords against HIBP", pwCount, style, !quiet);
    try {
      const compromisedCount = await detectCompromisedPasswords(
        vaultData,
        (_done, _total, label) => {
          progress.advance(1, label);
        },
      );
      report.compromisedPasswordsFound = compromisedCount;
      report.checksRun!.compromised = true;
      if (compromisedCount > 0) {
        progress.warn(`Found ${compromisedCount} compromised password(s)!`);
      } else {
        progress.succeed("No compromised passwords found in HIBP.");
      }
    } catch (err) {
      progress.fail(`HIBP check failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // 9. Mobile URI validation
  if (options.validateMobileUris) {
    const mobileCount = vaultData.items.reduce((sum, item) => {
      const matches = (item.login?.uris ?? []).filter((u) => {
        const s = getUriString(u);
        return s.startsWith("androidapp://") || s.startsWith("iosapp://");
      });
      return sum + matches.length;
    }, 0);
    const progress = await startProgress("Validating mobile app URIs", mobileCount, style, !quiet);
    const mobile = await detectAndValidateMobileAppUris(vaultData, (_done, _total, uri) => {
      progress.advance(1, uri);
    });
    report.validMobileUris = mobile.valid;
    report.invalidMobileUris = mobile.invalid;
    progress.succeed(
      `Mobile URI check complete (${mobile.valid.length} valid, ${mobile.invalid.length} invalid).`,
    );
  }

  // 9b. Opt-in URI reachability & redirect check
  if (options.checkRedirects || options.fixRedirects) {
    const httpCount = vaultData.items.reduce((sum, item) => {
      const matches = (item.login?.uris ?? []).filter((u) => /^https?:\/\//i.test(getUriString(u)));
      return sum + matches.length;
    }, 0);
    const progress = await startProgress("Checking URLs for redirects", httpCount, style, !quiet);
    const reachability = await checkUriReachability(vaultData, (_done, _total, uri) => {
      progress.advance(1, uri);
    });
    report.redirectsFound = reachability.redirects.length;
    report.deadLinksFound = reachability.deadLinks.length;
    progress.succeed(
      `URL reachability check complete (${reachability.redirects.length} redirect(s), ${reachability.deadLinks.length} dead/unreachable).`,
    );

    if (options.fixRedirects && !options.dryRun && reachability.redirects.length > 0) {
      report.redirectsApplied = applyRedirectUpdates(vaultData, reachability.redirects);
      log(`${style.green("✔")} Added ${report.redirectsApplied} redirected URI(s).`);
    }
  }

  // 10. AI enhancements
  const hasAnyAiTask = Boolean(
    options.enableAI ||
    options.aiOrganize ||
    options.aiDuplicates ||
    options.aiSuggestUris ||
    options.aiHygiene,
  );
  const aiProviderId: AiProviderId = options.aiProvider ?? "openai";
  if (hasAnyAiTask && !quiet && isNonLocalAiEndpoint(aiProviderId, options.aiBaseUrl)) {
    const providerMeta = AI_PROVIDER_REGISTRY[aiProviderId];
    log(
      `${style.yellow("⚠ Non-Local AI Disclaimer:")} Using ${style.bold(providerMeta.displayName)} sends item names, hostnames, and temporary numeric references (never persistent item IDs, folder names, passwords, usernames, TOTP, or notes) to an external cloud endpoint, subject to that provider's privacy and retention policies. Use ${style.bold("--ai-provider ollama")} for 100% local processing.`,
    );
  }

  const aiOpts = {
    provider: aiProviderId,
    model: options.aiModel,
    baseUrl: options.aiBaseUrl,
    apiKey: options.aiApiKey,
  };

  if (options.enableAI && !options.aiOrganize) {
    if (options.dryRun) {
      log(style.dim("Skipping AI categorization in --dry-run mode."));
    } else {
      const spinner = startSpinner(
        `Applying AI folder categorization (${options.aiProvider ?? "openai"})...`,
        style,
        !quiet,
      );
      try {
        const res = await categorizeVaultWithAi(vaultData, aiOpts);
        spinner.succeed(
          `AI folder categorization complete (${res.categorizedCount} categorized, ${res.createdFolders} new folder(s)).`,
        );
      } catch (err) {
        spinner.fail(`AI categorization failed: ${(err as Error).message}`);
        throw err;
      }
    }
  }

  if (options.aiOrganize) {
    if (options.dryRun) {
      log(style.dim("Skipping AI organize & rename in --dry-run mode."));
    } else {
      const spinner = startSpinner(
        `Organizing folders & cleaning item names (${options.aiProvider ?? "openai"})...`,
        style,
        !quiet,
      );
      try {
        const res = await organizeVaultWithAi(vaultData, aiOpts);
        report.aiRenamedCount = res.renamedCount;
        spinner.succeed(
          `AI organize complete (${res.categorizedCount} categorized, ${res.createdFolders} new folder(s), ${res.renamedCount} renamed).`,
        );
      } catch (err) {
        spinner.fail(`AI organize failed: ${(err as Error).message}`);
        throw err;
      }
    }
  }

  if (options.aiSuggestUris) {
    if (options.dryRun) {
      log(style.dim("Skipping AI URI suggestions in --dry-run mode."));
    } else {
      const spinner = startSpinner(
        `Inferring missing login URIs (${options.aiProvider ?? "openai"})...`,
        style,
        !quiet,
      );
      try {
        const res = await suggestUrisWithAi(vaultData, aiOpts, false);
        report.aiUriSuggestions = res.suggestions;
        spinner.succeed(
          `AI URI suggestions complete (${res.suggestions.length} suggestion(s); review before applying).`,
        );
        if (!quiet && res.suggestions.length > 0) {
          log(
            style.dim(
              "Verify each suggested domain on the service's official site before adding it; an incorrect login URI can expose credentials through autofill.",
            ),
          );
          const refs = buildAiItemRefs(vaultData);
          const rows = res.suggestions.map((suggestion) => {
            const item = vaultData.items[refs.indexOf(suggestion.itemId)];
            return [item?.name || suggestion.itemId, suggestion.suggestedUri, suggestion.reason];
          });
          log(renderTable(["Item", "Suggested HTTPS URI", "Reason"], rows, { style }));
        }
      } catch (err) {
        spinner.fail(`AI URI suggestion failed: ${(err as Error).message}`);
        throw err;
      }
    }
  }

  if (options.aiDuplicates && options.dryRun) {
    log(style.dim("Skipping AI duplicate detection in --dry-run mode."));
  } else if (options.aiDuplicates) {
    const spinner = startSpinner(
      `Detecting semantic duplicates (${options.aiProvider ?? "openai"})...`,
      style,
      !quiet,
    );
    try {
      const suggestions = await detectDuplicatesWithAi(vaultData, aiOpts);
      report.aiDuplicatesFound = suggestions.length;
      spinner.succeed(
        `AI duplicate scan complete (${suggestions.length} semantic group(s) found).`,
      );
      if (!quiet && suggestions.length > 0) {
        const rows = suggestions.map((s, idx) => {
          const resolved = buildDuplicateGroupFromIds(
            vaultData,
            s.itemIds,
            s.suggestedName,
            `ai-dup-${idx}`,
          );
          const flags: string[] = [s.confidence.toUpperCase()];
          if (resolved?.conflicts.hasDifferentUsernames) flags.push("diff users");
          if (resolved?.conflicts.hasDifferentPasswords) flags.push("diff passwords");
          return [s.suggestedName, String(s.itemIds.length), flags.join(", "), s.reason];
        });
        log(renderTable(["Group", "Items", "Confidence / Conflicts", "Reason"], rows, { style }));
      }
    } catch (err) {
      spinner.fail(`AI duplicate detection failed: ${(err as Error).message}`);
      throw err;
    }
  }

  if (options.aiHygiene && options.dryRun) {
    log(style.dim("Skipping AI hygiene audit in --dry-run mode."));
  } else if (options.aiHygiene) {
    const spinner = startSpinner(
      `Auditing vault hygiene (${options.aiProvider ?? "openai"})...`,
      style,
      !quiet,
    );
    try {
      const findings = await analyzeHygieneWithAi(vaultData, aiOpts);
      report.aiHygieneFindings = findings;
      report.aiHygieneDisclaimer =
        "AI hygiene findings are unverified suggestions; current service status and security claims are not checked.";
      spinner.succeed(`AI hygiene audit complete (${findings.length} finding(s)).`);
      if (!quiet && findings.length > 0) {
        log(style.dim(report.aiHygieneDisclaimer));
        const rows = findings.map((f) => [
          f.severity.toUpperCase(),
          f.category,
          f.title,
          f.recommendation,
        ]);
        log(renderTable(["Severity", "Category", "Finding", "Recommendation"], rows, { style }));
      }
    } catch (err) {
      spinner.fail(`AI hygiene audit failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // 10.5 Rule-based Linter & Autofix
  const shouldRunLint = Boolean(
    options.lint ||
    options.fix ||
    options.audit ||
    options.sarif ||
    options.ruleset ||
    options.config ||
    options.ruleOverrides?.length,
  );
  if (shouldRunLint) {
    const lintConfig = loadEffectiveLintConfig(options);
    if (options.fix) {
      const fixResult = applyLintFixes(vaultData, {
        config: lintConfig,
        unsafe: Boolean(options.fixUnsafe),
        dryRun: Boolean(options.dryRun),
      });
      report.lintFixesApplied = fixResult.appliedCount;
      report.lint = fixResult.lintAfter;
      if (!quiet) {
        log(
          `${style.green("✔")} Autofix ${options.dryRun ? "[dry-run] previewed" : "applied"} ${style.bold(String(fixResult.appliedCount))} fix(es).`,
        );
        if (fixResult.skippedUnsafeCount > 0) {
          log(
            style.dim(
              `  ${fixResult.skippedUnsafeCount} unsafe fix(es) skipped (pass --fix-unsafe to apply password/merge fixes).`,
            ),
          );
        }
      }
    } else {
      report.lint = lintVault(vaultData, lintConfig);
    }

    if ((options.lint || options.fix) && report.lint && !quiet) {
      printLintFindings(report.lint, style, Boolean(options.verbose));
    }
  }

  report.totalItemsAfter = vaultData.items.length;
  const healthAfter = computeVaultHealth(vaultData);
  report.healthScoreAfter = healthAfter.healthScore;
  report.healthSummary = healthAfter;

  // 11. List / Search / Filter view
  if ((options.list || options.search || options.filter) && !options.json) {
    log(renderSection("Vault Items", style));
    log(renderVaultItemsTable(vaultData, options, style));
  }

  // 12. Save output
  const hasMutations =
    report.duplicatesMerged > 0 ||
    (report.migrationItemsAdded ?? 0) > 0 ||
    (report.migrationItemsUpdated ?? 0) > 0 ||
    report.batchEditsApplied > 0 ||
    report.domainMappingsApplied > 0 ||
    report.weakPasswordsUpdated > 0 ||
    report.reusedPasswordsUpdated > 0 ||
    report.redirectsApplied > 0 ||
    (report.lintFixesApplied ?? 0) > 0 ||
    Boolean(options.aegisImport) ||
    Boolean(options.enableAI) ||
    Boolean(options.aiOrganize) ||
    Boolean(options.normalize);

  const targetOutput = options.output || (options.inPlace ? options.input : undefined);
  const overwrittenInputLabels = targetOutput
    ? [
        { path: options.fromCli ? undefined : options.input, label: "input vault" },
        { path: options.mergeInput, label: "merge input vault" },
        { path: options.aegisImport, label: "Aegis import file" },
        { path: options.domainMappings, label: "domain mappings file" },
        { path: options.config, label: "lint config file" },
        { path: options.sarifBaseline, label: "SARIF baseline" },
      ]
        .filter(({ path }) => path && isSamePath(targetOutput, path))
        .map(({ label }) => label)
    : [];
  const overwritesInput = overwrittenInputLabels.includes("input vault");

  if (!options.dryRun && targetOutput) {
    let shouldWrite = true;
    if ((options.inPlace || overwrittenInputLabels.length > 0) && !options.skipConfirmation) {
      if (!process.stdin.isTTY || options.json) {
        throw new Error(
          options.inPlace || overwritesInput
            ? "Refusing to overwrite in-place without confirmation. Re-run with -s to skip the prompt."
            : "Refusing to overwrite a protected input (" +
                overwrittenInputLabels.join(", ") +
                ") without confirmation. Re-run with -s to skip the prompt.",
        );
      }
      const clack = await loadClack();
      const confirmed = await clack.confirm({
        message:
          options.inPlace || overwritesInput
            ? `Overwrite "${targetOutput}" in-place?`
            : 'The output path "' +
              targetOutput +
              '" is also the ' +
              overwrittenInputLabels.join(", ") +
              ". Overwrite it?",
        initialValue: false,
      });
      shouldWrite = !clack.isCancel(confirmed) && Boolean(confirmed);
    }

    if (shouldWrite) {
      if (options.backup && fs.existsSync(targetOutput)) {
        const backupPath = `${targetOutput}.bak`;
        assertSafeReportTarget(backupPath, "vault backup", [
          ...protectedReportPaths(options),
          { path: options.migrationReport, label: "migration report" },
          { path: options.exportReport, label: "summary report" },
          { path: options.sarif, label: "SARIF report" },
        ]);
        fs.copyFileSync(targetOutput, backupPath);
        log(`${style.dim(`Backup created at ${backupPath}`)}`);
      }
      const targetFormat =
        options.outputFormat ?? inferFormatFromOutputPath(targetOutput, parsed.format);
      report.outputFormat = targetFormat;
      await saveProcessedVault(vaultData, targetOutput, {
        format: targetFormat,
        rawMeta: targetFormat === parsed.format ? parsed.rawMeta : undefined,
      });
    } else {
      log(style.yellow("Save cancelled."));
    }
  } else if (options.dryRun && !quiet) {
    log(style.dim("Dry-run mode: no changes written to disk."));
  } else if (hasMutations && !targetOutput && !quiet) {
    log(
      style.yellow(
        "⚠ Vault was modified in memory, but no --output or --in-place path was provided; changes were not saved.",
      ),
    );
  }

  // Push changes back through the vendor CLI (opt-in, previewed, confirmed).
  if (options.pushToCli && vendor && vendorOriginal) {
    await pushThroughVendorCli({ options, vendor, vendorOriginal, vaultData, style, log });
  }

  // 13. Export report (Markdown when .md, JSON otherwise)
  if (options.exportReport) {
    if (options.exportReport.toLowerCase().endsWith(".md")) {
      writeReportFile(
        options.exportReport,
        formatMarkdownReport(report, healthAfter),
        "summary report",
        protectedReportPaths(options),
      );
    } else {
      writeReportFile(
        options.exportReport,
        JSON.stringify(report, null, 2),
        "summary report",
        protectedReportPaths(options),
      );
    }
    log(`${style.green("✔")} Summary report exported to ${options.exportReport}`);
  }

  if (options.sarif && report.lint) {
    const baselinePath = options.sarifBaseline;
    const baselineFingerprints = sarifBaselineFingerprints;
    const rules = LINT_RULES.map((rule) => ({
      id: rule.id,
      shortDescription: { text: rule.title },
      fullDescription: { text: rule.description },
      defaultConfiguration: {
        level:
          rule.defaultSeverity === "off"
            ? "none"
            : rule.defaultSeverity === "error"
              ? "error"
              : rule.defaultSeverity === "warning"
                ? "warning"
                : "note",
      },
      properties: { category: rule.category, fixable: rule.fixable },
    }));
    const fingerprintOf = createFindingFingerprinter(vaultData);
    const sarifResults = report.lint.findings.map((finding) => {
      const fingerprint = fingerprintOf(finding);
      const baselineState = baselineFingerprints.has(fingerprint) ? "unchanged" : "new";
      return {
        ruleId: finding.ruleId,
        level:
          finding.severity === "error"
            ? "error"
            : finding.severity === "warning"
              ? "warning"
              : "note",
        message: { text: finding.message },
        baselineState,
        fingerprints: { "vaultlint/v1": fingerprint },
        properties: {
          itemIndex: finding.itemIndex,
          itemId: finding.itemId,
          itemName: finding.itemName,
          category: finding.category,
        },
      };
    });
    report.sarifNewFindingCount = sarifResults.filter(
      (result) => result.baselineState === "new",
    ).length;
    report.sarifNewErrorCount = sarifResults.filter(
      (result) => result.baselineState === "new" && result.level === "error",
    ).length;
    report.sarifNewWarningCount = sarifResults.filter(
      (result) => result.baselineState === "new" && result.level === "warning",
    ).length;
    const sarif = {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "vaultlint",
              informationUri: "https://github.com/robertbaker/vaultlint",
              rules,
            },
          },
          results: sarifResults,
          properties: {
            ruleset: report.lint.ruleset,
            counts: report.lint.counts,
            ...(baselinePath
              ? {
                  baselinePath,
                  newFindingCount: report.sarifNewFindingCount,
                  newErrorCount: report.sarifNewErrorCount,
                  newWarningCount: report.sarifNewWarningCount,
                }
              : {}),
          },
        },
      ],
    };
    writeReportFile(
      options.sarif,
      JSON.stringify(sarif, null, 2),
      "SARIF report",
      protectedReportPaths(options),
    );
    log(`${style.green("✔")} SARIF findings exported to ${options.sarif}`);
    if (baselinePath) {
      log(
        `  New findings: ${report.sarifNewFindingCount} (${report.sarifNewErrorCount} errors, ${report.sarifNewWarningCount} warnings)`,
      );
    }
  }

  // 14. Output
  if (options.json) {
    const payload =
      options.list || options.search || options.filter
        ? {
            report,
            items: filterVaultItems(vaultData, options.search, options.filter).items.map((i) => ({
              id: i.id,
              name: i.name,
              username: i.login?.username ?? null,
              uris: (i.login?.uris ?? []).map((u) => redactUriCredentials(getUriString(u))),
              hasTotp: Boolean(i.login?.totp),
              hasFido: hasFidoCredentials(i),
              weakPassword: Boolean(i.login?.password && isWeakPassword(i.login.password)),
            })),
          }
        : report;
    writeStdout(JSON.stringify(payload, null, 2));
  } else if (!options.quiet) {
    printReport(report, healthAfter, style);
  }

  return report;
}

async function pushThroughVendorCli(args: {
  options: VaultEnhancementOptions;
  vendor: Awaited<ReturnType<typeof fetchFromVendorCli>>;
  vendorOriginal: VaultData;
  vaultData: VaultData;
  style: CliStyle;
  log: (msg: string) => void;
}): Promise<void> {
  const { options, vendor, vendorOriginal, vaultData, style, log } = args;
  const { provider } = vendor;
  const support = describeVendorCliSupport(provider);
  if (!support.write || !provider.planPush || !provider.push) {
    throw new Error(
      provider.unsupportedReason?.write ?? `${provider.displayName} does not support push.`,
    );
  }

  const plan = provider.planPush(vendorOriginal, vaultData);
  const total =
    plan.creates +
    plan.updates +
    plan.removes +
    plan.newFolders +
    plan.updatedFolders +
    plan.removedFolders;
  if (total === 0) {
    log(style.dim(`No changes to push to ${provider.displayName}.`));
    return;
  }

  log(
    `${style.bold(`${provider.displayName} push plan`)}: ${plan.updates} update(s), ${plan.creates} create(s), ${plan.removes} move(s) to trash, ${plan.newFolders} new folder(s), ${plan.updatedFolders} folder rename(s), ${plan.removedFolders} permanent folder deletion(s)`,
  );
  for (const line of plan.lines) log(`  ${line}`);

  if (options.dryRun) {
    log(style.dim("Dry-run mode: nothing was pushed."));
    return;
  }

  let confirmed = Boolean(options.skipConfirmation);
  if (!confirmed) {
    if (!process.stdin.isTTY || options.json) {
      throw new Error("Refusing to push without confirmation. Re-run with -s to skip the prompt.");
    }
    const clack = await loadClack();
    const answer = await clack.confirm({
      message: `Apply these changes to your live ${provider.displayName} vault?`,
      initialValue: false,
    });
    confirmed = !clack.isCancel(answer) && Boolean(answer);
  }
  if (!confirmed) {
    log(style.yellow("Push cancelled."));
    return;
  }

  const runner = options.vendorRunner ?? nodeCommandRunner;
  const result = await provider.push(runner, vendorOriginal, vaultData);
  log(
    `${style.green("✔")} Pushed to ${provider.displayName}: ${result.updated} updated, ${result.created} created, ${result.removed} moved to trash, ${result.newFolders} folder(s) created, ${result.updatedFolders} folder(s) renamed, ${result.removedFolders} folder(s) permanently deleted`,
  );
}

function readSarifBaselineFingerprints(filePath: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8Text(filePath));
  } catch (err) {
    throw new Error(`Could not read SARIF baseline "${filePath}": ${(err as Error).message}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { runs?: unknown }).runs)
  ) {
    throw new Error(`Invalid SARIF baseline "${filePath}": expected a SARIF document with runs.`);
  }
  const fingerprints = new Set<string>();
  for (const run of (parsed as { runs: unknown[] }).runs) {
    if (!run || typeof run !== "object") continue;
    const results = (run as { results?: unknown }).results;
    if (!Array.isArray(results)) continue;
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const value = (result as { fingerprints?: Record<string, unknown> }).fingerprints?.[
        "vaultlint/v1"
      ];
      if (typeof value === "string") fingerprints.add(value);
    }
  }
  return fingerprints;
}

/**
 * Build a fingerprint function for one vault. Everything that needs to look at other items (ID
 * counts, first occurrence of an ID, ordinal among look-alike items) is indexed once, so computing
 * a fingerprint per finding is O(log n) instead of rescanning the whole vault each time.
 */
function createFindingFingerprinter(
  vaultData: VaultData,
): (finding: LintResult["findings"][number]) => string {
  const items = vaultData.items;
  const idCounts = new Map<string, number>();
  const firstIdIndex = new Map<string, number>();
  items.forEach((candidate, index) => {
    if (!candidate.id) return;
    idCounts.set(candidate.id, (idCounts.get(candidate.id) ?? 0) + 1);
    if (!firstIdIndex.has(candidate.id)) firstIdIndex.set(candidate.id, index);
  });

  const baseKeys: string[] = [];
  const baseKeyOf = (item: VaultItem): string => {
    const name = (item.name ?? "").trim().toLowerCase();
    const username = (item.login?.username ?? "").trim().toLowerCase();
    const host = extractDomainParts(getUriString(item.login?.uris?.[0])).hostname;
    return `${name} ${username} ${host}`;
  };
  // Ascending item indices per (id scope, base key); built lazily because most vaults never need it.
  let lookAlikes: Map<string, number[]> | undefined;
  const scopeKey = (id: string | undefined, base: string) => `${id ? `id:${id}` : "none"}${base}`;
  const occurrenceBefore = (
    itemId: string | undefined,
    base: string,
    itemIndex: number,
  ): number => {
    if (!lookAlikes) {
      lookAlikes = new Map();
      items.forEach((candidate, index) => {
        baseKeys[index] = baseKeyOf(candidate);
        const key = scopeKey(candidate.id, baseKeys[index]);
        const list = lookAlikes!.get(key);
        if (list) list.push(index);
        else lookAlikes!.set(key, [index]);
      });
    }
    const list = lookAlikes.get(scopeKey(itemId, base));
    if (!list) return 0;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (list[mid] < itemIndex) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  return (finding) => {
    const item = items[finding.itemIndex];
    const itemId = finding.itemId ?? item?.id;
    const idCount = itemId ? (idCounts.get(itemId) ?? 0) : 0;
    let identity: string;
    if (itemId && idCount === 1) {
      identity = `id:${itemId}`;
    } else if (item) {
      const base = baseKeyOf(item);
      const occurrence = occurrenceBefore(itemId, base, finding.itemIndex);
      // Preserve the existing stable-ID fingerprint for the first occurrence so adding a malformed
      // duplicate ID does not make every prior finding appear new. Later occurrences include their
      // metadata and ordinal so they cannot collapse into the first item's baseline fingerprint.
      const firstIndex = itemId ? firstIdIndex.get(itemId) : undefined;
      const firstIdOccurrence =
        itemId && (firstIndex === undefined || firstIndex >= finding.itemIndex);
      identity = firstIdOccurrence
        ? `id:${itemId}`
        : `composite:${itemId ? `id:${itemId} ` : ""}${base} ${occurrence}`;
    } else {
      identity = itemId ? `id:${itemId}` : `index:${finding.itemIndex}`;
    }
    return createHash("sha256").update(`vaultlint/v1 ${finding.ruleId} ${identity}`).digest("hex");
  };
}

/** Print rule-based lint findings grouped by severity (error, warning, hint). */
export function printLintFindings(lint: LintResult, style: CliStyle, verbose = false): void {
  console.log(renderSection(`Vault Linter (ruleset: ${lint.ruleset})`, style));
  console.log(
    `  Findings: ${style.red(`${lint.counts.error} error(s)`)} · ${style.yellow(`${lint.counts.warning} warning(s)`)} · ${style.cyan(`${lint.counts.hint} hint(s)`)}  ${style.dim(`(${lint.counts.fixableSafe} safe autofix, ${lint.counts.fixableUnsafe} unsafe autofix)`)}`,
  );

  if (lint.findings.length === 0) {
    console.log(`  ${style.green("✔")} No lint issues found.\n`);
    return;
  }

  const limit = verbose ? lint.findings.length : 25;
  const rows = lint.findings.slice(0, limit).map((f) => {
    const sevBadge =
      f.severity === "error"
        ? style.red("ERROR")
        : f.severity === "warning"
          ? style.yellow("WARN ")
          : style.cyan("HINT ");
    const fixBadge = f.fixable ? style.dim(`[${f.fixable}]`) : "—";
    return [sevBadge, f.ruleId, f.itemName, f.message, fixBadge];
  });

  console.log("");
  console.log(
    renderTable(["Severity", "Rule", "Item", "Message", "Autofix"], rows, {
      maxColWidth: 48,
      style,
    }),
  );
  if (!verbose && lint.findings.length > limit) {
    console.log(
      style.dim(
        `  ...and ${lint.findings.length - limit} more finding(s). Pass --verbose to list all.`,
      ),
    );
  }
  console.log("");
}

/** Summary cell text: "not checked" when the check did not run, so a 0 never looks computed. */
function checkResult(
  report: EnhancementReport,
  check: keyof NonNullable<EnhancementReport["checksRun"]>,
  computed: string,
): string {
  return report.checksRun && !report.checksRun[check] ? "not checked" : computed;
}

export function printReport(
  report: EnhancementReport,
  health: VaultHealthSummary,
  style: CliStyle,
): void {
  const delta = report.healthScoreAfter - report.healthScoreBefore;
  const deltaText =
    delta > 0
      ? ` ${style.green(`(+${delta}% from ${report.healthScoreBefore}%)`)}`
      : delta < 0
        ? ` ${style.red(`(${delta}% from ${report.healthScoreBefore}%)`)}`
        : "";

  console.log(renderSection("Vault Health & Summary Report", style));
  const findingLines = [
    health.duplicateItemCount > 0 ? `Duplicates: ${health.duplicateItemCount}` : undefined,
    health.weakPasswordCount > 0 ? `Weak passwords: ${health.weakPasswordCount}` : undefined,
    health.reusedItemCount > 0 ? `Reused passwords: ${health.reusedItemCount}` : undefined,
    health.malformedUriCount > 0 ? `Malformed URIs: ${health.malformedUriCount}` : undefined,
    report.compromisedPasswordsFound > 0
      ? `Compromised passwords: ${report.compromisedPasswordsFound}`
      : undefined,
    report.lint && report.lint.counts.error + report.lint.counts.warning > 0
      ? `Lint: ${report.lint.counts.error} errors, ${report.lint.counts.warning} warnings`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  if (findingLines.length === 0) {
    console.log(
      renderBox(
        "No common health issues found",
        ["Use --lint to check custom rules and policy."],
        style,
        "success",
      ),
    );
  } else {
    console.log(
      renderBox(
        "Items to review",
        [...findingLines, "Inspect with --list --filter <type> or run the interactive menu."],
        style,
        "warn",
      ),
    );
  }
  console.log("");
  console.log(`  Health Score : ${renderProgressBar(health.healthScore, style)}${deltaText}`);
  console.log(
    `  Vault Stats  : ${health.totalItems} items · ${health.loginItems} logins · ${health.foldersCount} folders · ${health.totpCount} TOTP · ${health.fidoCount} FIDO`,
  );

  const summaryRows: string[][] = [
    ["Items", `${report.totalItemsBefore} -> ${report.totalItemsAfter}`],
    ["Duplicates", `${report.duplicatesFound} found, ${report.duplicatesMerged} merged`],
    [
      "Weak passwords",
      checkResult(
        report,
        "weakPasswords",
        `${report.weakPasswordsFound} found, ${report.weakPasswordsUpdated} updated`,
      ),
    ],
    [
      "Reused passwords",
      checkResult(
        report,
        "reusedPasswords",
        `${report.reusedPasswordGroups} group(s) (${report.reusedPasswordsFound} items), ${report.reusedPasswordsUpdated} updated`,
      ),
    ],
    ["Malformed URIs", checkResult(report, "malformedUris", `${report.malformedUrisFound} found`)],
    ["Batch edits", `${report.batchEditsApplied} applied`],
    ["Domain mappings", `${report.domainMappingsApplied} applied`],
    [
      "Compromised (HIBP)",
      checkResult(report, "compromised", `${report.compromisedPasswordsFound} found`),
    ],
    ...(report.aiUriSuggestions
      ? [["AI URI suggestions", `${report.aiUriSuggestions.length} found; review before applying`]]
      : []),
  ];
  if (report.lint) {
    summaryRows.push([
      `Linter (${report.lint.ruleset})`,
      `${report.lint.counts.error} error, ${report.lint.counts.warning} warning, ${report.lint.counts.hint} hint`,
    ]);
  }

  console.log("");
  console.log(renderTable(["Metric", "Result"], summaryRows, { maxColWidth: 50, style }));
  console.log("");
}

/** Format an audit/enhancement report as a sanitized Markdown document. */
export function formatMarkdownReport(
  report: EnhancementReport,
  health: VaultHealthSummary,
): string {
  return [
    "# Vault Audit & Enhancement Report",
    "",
    `- **Health Score**: ${report.healthScoreBefore}% -> **${report.healthScoreAfter}%**`,
    `- **Vault Overview**: ${health.totalItems} items, ${health.loginItems} logins, ${health.foldersCount} folders, ${health.totpCount} TOTP, ${health.fidoCount} FIDO`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| Items | ${report.totalItemsBefore} -> ${report.totalItemsAfter} |`,
    `| Duplicates | ${report.duplicatesFound} found, ${report.duplicatesMerged} merged |`,
    `| Weak passwords | ${checkResult(report, "weakPasswords", `${report.weakPasswordsFound} found, ${report.weakPasswordsUpdated} updated`)} |`,
    `| Reused passwords | ${checkResult(report, "reusedPasswords", `${report.reusedPasswordGroups} group(s) (${report.reusedPasswordsFound} items), ${report.reusedPasswordsUpdated} updated`)} |`,
    `| Malformed URIs | ${checkResult(report, "malformedUris", `${report.malformedUrisFound} found`)} |`,
    `| Batch edits | ${report.batchEditsApplied} applied |`,
    `| Domain mappings | ${report.domainMappingsApplied} applied |`,
    `| Compromised (HIBP) | ${checkResult(report, "compromised", `${report.compromisedPasswordsFound} found`)} |`,
    ...(report.aiUriSuggestions
      ? [`| AI URI suggestions | ${report.aiUriSuggestions.length} found; review before applying |`]
      : []),
    ...(report.lint
      ? [
          `| Linter (${report.lint.ruleset}) | ${report.lint.counts.error} error, ${report.lint.counts.warning} warning, ${report.lint.counts.hint} hint |`,
        ]
      : []),
    ...(report.aiHygieneDisclaimer ? [``, `> ${report.aiHygieneDisclaimer}`] : []),
    "",
  ].join("\n");
}
