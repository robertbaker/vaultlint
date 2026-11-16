import fs from "fs";

import { BRAND_NAME } from "@vaultlint/brand";
import { inferFormatFromOutputPath, type VaultFormatId } from "@vaultlint/vault-formats";
import { getSafeUriDisplayLabel } from "@vaultlint/vault-schema";

import { handleAegisImport } from "./aegisManager";
import { applyBatchEdits, previewBatchEdits, runBatchEditing } from "./batchService";
import {
  type CliStyle,
  createCliStyle,
  isColorSupported,
  loadClack,
  renderBrandHeader,
  renderProgressBar,
  renderTable,
} from "./cliUi";
import { applyDomainMappings, loadDomainMappings } from "./domainMappingService";
import { findDuplicateGroups, findAndMergeDuplicates } from "./duplicateService";
import { assertSafeReportTarget, writeReportFile } from "./safeWrite";
import { canRedo, canUndo, clearHistory, redo, runTracked, undo } from "./undoRedoManager";
import {
  type EnhancementReport,
  formatMarkdownReport,
  printReport,
  renderVaultItemsTable,
  type VaultFilterType,
} from "./vaultManager";
import {
  batchUpdateReusedPasswords,
  batchUpdateWeakPasswords,
  computeVaultHealth,
  detectCompromisedPasswords,
  findMalformedUris,
  findReusedPasswordGroups,
  findWeakPasswordItems,
  generateStrongPassword,
  loadVaultWithMeta,
  saveVault,
  type VaultData,
} from "./vaultService";

type MenuAction =
  | "quick-fix"
  | "summary"
  | "audit"
  | "browse"
  | "merge-duplicates"
  | "fix-weak"
  | "fix-reused"
  | "batch-edit"
  | "normalize"
  | "domain-mappings"
  | "aegis-import"
  | "check-hibp"
  | "generate-password"
  | "export-report"
  | "undo"
  | "redo"
  | "save"
  | "back"
  | "exit";

type MenuSection = "review" | "cleanup" | "tools" | "session";

export interface InteractiveSaveOptions {
  /** Preview only: never write the vault file. */
  dryRun?: boolean;
  /** Copy an existing target to `<target>.bak` before overwriting it. */
  backup?: boolean;
}

/**
 * Write the session's vault for the Save action, honoring `--dry-run` (nothing is written) and
 * `--backup` (existing target copied to `.bak` first).
 */
export async function writeInteractiveSave(
  vaultData: VaultData,
  savePath: string,
  format: VaultFormatId,
  rawMeta: Record<string, unknown> | undefined,
  options: InteractiveSaveOptions = {},
): Promise<{ written: boolean; backupPath?: string }> {
  if (options.dryRun) return { written: false };
  let backupPath: string | undefined;
  if (options.backup && fs.existsSync(savePath)) {
    backupPath = `${savePath}.bak`;
    assertSafeReportTarget(backupPath, "vault backup");
    fs.copyFileSync(savePath, backupPath);
  }
  await saveVault(vaultData, savePath, undefined, { format, rawMeta });
  return { written: true, backupPath };
}

export function resolveInteractiveOutputFormat(
  savePath: string,
  sourceFormat: VaultFormatId,
  outputFormat?: VaultFormatId,
): VaultFormatId {
  return outputFormat ?? inferFormatFromOutputPath(savePath, sourceFormat);
}

function showAuditDetails(vaultData: VaultData, style: CliStyle): void {
  const health = computeVaultHealth(vaultData);
  const dupGroups = findDuplicateGroups(vaultData);
  const weakItems = findWeakPasswordItems(vaultData);
  const reusedGroups = findReusedPasswordGroups(vaultData);
  const uriIssues = findMalformedUris(vaultData);

  console.log("");
  console.log(`  Health Score: ${renderProgressBar(health.healthScore, style)}`);
  console.log(
    `  Duplicates: ${dupGroups.length} group(s) | Weak: ${weakItems.length} | Reused groups: ${reusedGroups.length} | Malformed URIs: ${uriIssues.length}`,
  );

  if (dupGroups.length > 0) {
    console.log(style.yellow("\n  Duplicate Groups:"));
    console.log(
      renderTable(
        ["Name", "Count", "Usernames"],
        dupGroups
          .slice(0, 15)
          .map((g) => [
            g.name,
            String(g.items.length),
            g.items.map((i) => i.login?.username || "—").join(", "),
          ]),
        { alignRight: [1], style },
      ),
    );
  }

  if (uriIssues.length > 0) {
    console.log(style.yellow("\n  Malformed URIs:"));
    console.log(
      renderTable(
        ["Item", "URI", "Issue"],
        uriIssues
          .slice(0, 15)
          .map((u) => [u.item.name || "(unnamed)", getSafeUriDisplayLabel(u.uri), u.reason]),
        { maxColWidth: 34, style },
      ),
    );
  }
  console.log("");
}

function buildInteractiveReport(
  vaultData: VaultData,
  initialCount: number,
  initialScore: number,
): { report: EnhancementReport; health: ReturnType<typeof computeVaultHealth> } {
  const health = computeVaultHealth(vaultData);
  return {
    health,
    report: {
      totalItemsBefore: initialCount,
      totalItemsAfter: vaultData.items.length,
      duplicatesFound: health.duplicateItemCount,
      duplicatesMerged: 0,
      batchEditsApplied: 0,
      domainMappingsApplied: 0,
      weakPasswordsFound: health.weakPasswordCount,
      weakPasswordsUpdated: 0,
      reusedPasswordGroups: health.reusedGroupCount,
      reusedPasswordsFound: health.reusedItemCount,
      reusedPasswordsUpdated: 0,
      malformedUrisFound: health.malformedUriCount,
      redirectsFound: 0,
      deadLinksFound: 0,
      redirectsApplied: 0,
      compromisedPasswordsFound: 0,
      validMobileUris: [],
      invalidMobileUris: [],
      healthScoreBefore: initialScore,
      healthScoreAfter: health.healthScore,
      healthSummary: health,
    },
  };
}

/** Run the interactive guided CLI menu powered by `@clack/prompts`. */
export async function runInteractiveCLI(
  inputPath: string,
  defaultOutputPath?: string,
  noColor = false,
  inputFormat?: VaultFormatId,
  outputFormat?: VaultFormatId,
  saveOptions: InteractiveSaveOptions = {},
): Promise<void> {
  const style = createCliStyle(isColorSupported(noColor));
  const clack = await loadClack();
  clearHistory();

  clack.intro(renderBrandHeader("Interactive", style));

  const loadSpin = clack.spinner();
  loadSpin.start(`Loading vault from ${inputPath}...`);
  let parsedInput;
  try {
    parsedInput = await loadVaultWithMeta(inputPath, undefined, { format: inputFormat });
  } catch (error) {
    loadSpin.stop(`Could not load ${inputPath}`);
    throw error;
  }
  let vaultData: VaultData = parsedInput.vault;
  const initialCount = vaultData.items.length;
  const initialScore = computeVaultHealth(vaultData).healthScore;
  let dirty = false;
  /** Mutate the vault; undo history and the dirty flag only change if it succeeds and changes data. */
  const mutate = async (fn: (vault: VaultData) => void | Promise<void>): Promise<boolean> => {
    const result = await runTracked(vaultData, fn);
    vaultData = result.state;
    if (result.error) throw result.error;
    if (result.changed) dirty = true;
    return result.changed;
  };
  loadSpin.stop(`Loaded ${style.bold(String(initialCount))} item(s) (Health: ${initialScore}%)`);

  let running = true;
  while (running) {
    const statusParts: string[] = [];
    if (dirty) statusParts.push(style.yellow("unsaved changes"));
    if (canUndo()) statusParts.push(style.dim("undo available"));
    if (canRedo()) statusParts.push(style.dim("redo available"));
    const statusLabel = statusParts.length > 0 ? ` (${statusParts.join(" · ")})` : "";
    const menuHealth = computeVaultHealth(vaultData);

    const section = await clack.select<MenuSection>({
      message: `Vault actions${statusLabel}`,
      options: [
        {
          value: "review",
          label: "Review vault",
          hint: `${menuHealth.totalItems} items · health ${menuHealth.healthScore}%`,
        },
        {
          value: "cleanup",
          label: "Clean up vault",
          hint: `${menuHealth.weakPasswordCount} weak · ${menuHealth.reusedGroupCount} reused · ${menuHealth.duplicateItemCount} duplicate`,
        },
        { value: "tools", label: "More tools", hint: "Batch edits, imports, reports, and checks" },
        {
          value: "session",
          label: "Session",
          hint:
            [canUndo() ? "undo" : "", canRedo() ? "redo" : "", dirty ? "unsaved" : ""]
              .filter(Boolean)
              .join(" · ") || "Save or exit",
        },
      ],
    });

    if (clack.isCancel(section)) {
      if (dirty) {
        const confirmExit = await clack.confirm({
          message: "You have unsaved changes. Exit anyway?",
          initialValue: false,
        });
        if (clack.isCancel(confirmExit) || !confirmExit) continue;
      }
      running = false;
      break;
    }

    const sectionOptions: Record<
      MenuSection,
      Array<{ value: MenuAction; label: string; hint?: string }>
    > = {
      review: [
        { value: "summary", label: "Vault summary", hint: "Health score and metrics" },
        { value: "audit", label: "Run full local audit", hint: "Duplicates, passwords, and URIs" },
        { value: "browse", label: "Browse items", hint: "Search and filter; passwords masked" },
      ],
      cleanup: [
        { value: "quick-fix", label: "Quick Fix Wizard", hint: "Choose several cleanup actions" },
        { value: "merge-duplicates", label: "Merge duplicates", hint: "Combine matching entries" },
        { value: "fix-weak", label: "Fix weak passwords", hint: "Generate strong replacements" },
        {
          value: "fix-reused",
          label: "Fix reused passwords",
          hint: "Generate unique replacements",
        },
        { value: "normalize", label: "Normalize names and URIs" },
      ],
      tools: [
        { value: "batch-edit", label: "Batch edit with regex", hint: "Preview before applying" },
        { value: "domain-mappings", label: "Apply domain mappings", hint: "From a JSON file" },
        { value: "aegis-import", label: "Import Aegis FIDO keys", hint: "Unencrypted export" },
        {
          value: "check-hibp",
          label: "Check compromised passwords",
          hint: "Optional HIBP k-anonymity lookup",
        },
        { value: "generate-password", label: "Generate a strong password" },
        { value: "export-report", label: "Export audit report", hint: "JSON or Markdown" },
      ],
      session: [
        ...(canUndo() ? [{ value: "undo" as const, label: "Undo last change" }] : []),
        ...(canRedo() ? [{ value: "redo" as const, label: "Redo last undone change" }] : []),
        { value: "save", label: "Save vault", hint: defaultOutputPath || inputPath },
        { value: "exit", label: "Exit session" },
      ],
    };

    const action = await clack.select<MenuAction>({
      message: `${section[0].toUpperCase()}${section.slice(1)} · Choose an action`,
      options: [...sectionOptions[section], { value: "back", label: "Back to sections" }],
    });
    if (clack.isCancel(action) || action === "back") continue;

    try {
      switch (action) {
        case "quick-fix": {
          const health = computeVaultHealth(vaultData);
          const picks = await clack.multiselect<"duplicates" | "weak" | "reused" | "normalize">({
            message: "Select cleanup actions to run:",
            required: false,
            options: [
              {
                value: "duplicates",
                label: "Merge duplicate entries",
                hint: `${health.duplicateItemCount} extra item(s)`,
              },
              {
                value: "weak",
                label: "Fix weak passwords",
                hint: `${health.weakPasswordCount} item(s)`,
              },
              {
                value: "reused",
                label: "Fix reused passwords",
                hint: `${health.reusedGroupCount} group(s)`,
              },
              {
                value: "normalize",
                label: "Normalize item names & URIs",
                hint: "Lowercase names, origin-only URIs",
              },
            ],
            initialValues: [
              ...(health.duplicateItemCount > 0 ? (["duplicates"] as const) : []),
              ...(health.weakPasswordCount > 0 ? (["weak"] as const) : []),
              ...(health.reusedGroupCount > 0 ? (["reused"] as const) : []),
            ],
          });
          if (clack.isCancel(picks) || picks.length === 0) break;

          const summaryLines: string[] = [];
          try {
            await mutate(async (vault) => {
              if (picks.includes("duplicates")) {
                const m = await findAndMergeDuplicates(vault);
                summaryLines.push(`Merged ${m} duplicate item(s)`);
              }
              if (picks.includes("weak")) {
                const w = batchUpdateWeakPasswords(vault);
                summaryLines.push(`Updated ${w} weak password(s)`);
              }
              if (picks.includes("reused")) {
                const r = batchUpdateReusedPasswords(vault);
                summaryLines.push(`Regenerated ${r} reused password(s)`);
              }
              if (picks.includes("normalize")) {
                await runBatchEditing(vault);
                summaryLines.push("Normalized item names and URIs");
              }
            });
          } catch (err) {
            clack.log.error(`Quick Fix failed and was rolled back: ${(err as Error).message}`);
            break;
          }
          const nextScore = computeVaultHealth(vaultData).healthScore;
          clack.note(
            `${summaryLines.join("\n")}\n\nHealth Score: ${health.healthScore}% -> ${nextScore}%`,
            "Quick Fix Complete",
          );
          break;
        }
        case "summary": {
          const { report, health } = buildInteractiveReport(vaultData, initialCount, initialScore);
          printReport(report, health, style);
          break;
        }
        case "audit":
          showAuditDetails(vaultData, style);
          break;
        case "browse": {
          const search = await clack.text({
            message: "Search query (leave blank for all):",
            placeholder: "e.g. github",
          });
          if (clack.isCancel(search)) break;

          const filter = await clack.select<VaultFilterType | "none">({
            message: "Filter by issue or feature:",
            options: [
              { value: "none", label: "All items" },
              { value: "weak", label: "Weak passwords" },
              { value: "reused", label: "Reused passwords" },
              { value: "duplicate", label: "Duplicate entries" },
              { value: "malformed-uri", label: "Malformed URIs" },
              { value: "no-uri", label: "Missing URIs" },
              { value: "fido", label: "Has FIDO passkey" },
              { value: "totp", label: "Has TOTP 2FA" },
            ],
          });
          if (clack.isCancel(filter)) break;

          console.log("");
          console.log(
            renderVaultItemsTable(
              vaultData,
              {
                search: (search ?? "").trim() || undefined,
                filter: filter === "none" ? undefined : filter,
              },
              style,
            ),
          );
          console.log("");
          break;
        }
        case "merge-duplicates": {
          let merged = 0;
          try {
            await mutate(async (vault) => {
              merged = await findAndMergeDuplicates(vault);
            });
          } catch (err) {
            clack.log.error(`Merge failed and was rolled back: ${(err as Error).message}`);
            break;
          }
          clack.log.success(`Merged ${merged} duplicate item(s).`);
          break;
        }
        case "fix-weak": {
          let updated = 0;
          await mutate((vault) => {
            updated = batchUpdateWeakPasswords(vault);
          });
          clack.log.success(`Updated ${updated} weak password(s).`);
          break;
        }
        case "fix-reused": {
          let updated = 0;
          await mutate((vault) => {
            updated = batchUpdateReusedPasswords(vault);
          });
          clack.log.success(`Regenerated ${updated} reused password(s).`);
          break;
        }
        case "batch-edit": {
          const field = await clack.select<"name" | "uri" | "username" | "notes">({
            message: "Target field to edit:",
            options: [
              { value: "name", label: "Item Name" },
              { value: "uri", label: "Login URIs" },
              { value: "username", label: "Username" },
              { value: "notes", label: "Notes" },
            ],
          });
          if (clack.isCancel(field)) break;

          const pattern = await clack.text({
            message: "Regex pattern:",
            placeholder: "^http://",
            validate: (val) => {
              if (!val) return "Pattern is required";
              try {
                new RegExp(val, "g");
                return undefined;
              } catch (err) {
                return `Invalid regex: ${(err as Error).message}`;
              }
            },
          });
          if (clack.isCancel(pattern)) break;

          const replacement = await clack.text({
            message: "Replacement text:",
            placeholder: "https://",
          });
          if (clack.isCancel(replacement)) break;

          const replacementText = replacement ?? "";
          const previews = previewBatchEdits(vaultData, pattern, replacementText, field);
          if (previews.length === 0) {
            clack.log.info("No items matched that pattern.");
            break;
          }

          console.log(
            renderTable(
              ["Item", "Before", "After"],
              previews.slice(0, 15).map((p) => [p.itemName, p.before, p.after]),
              { maxColWidth: 32, style },
            ),
          );

          const apply = await clack.confirm({
            message: `Apply ${previews.length} change(s)?`,
            initialValue: false,
          });
          if (clack.isCancel(apply) || !apply) {
            clack.log.info("Batch edit cancelled.");
            break;
          }

          try {
            await mutate(async (vault) => {
              await applyBatchEdits(vault, pattern, replacementText, field);
            });
            clack.log.success(`Applied ${previews.length} batch edit(s).`);
          } catch (err) {
            clack.log.error(`Batch edit failed and was rolled back: ${(err as Error).message}`);
          }
          break;
        }
        case "normalize": {
          const changed = await mutate((vault) => runBatchEditing(vault));
          clack.log.success(
            changed ? "Normalized item names and URIs." : "Names and URIs were already normalized.",
          );
          break;
        }
        case "domain-mappings": {
          const mapPath = await clack.text({
            message: "Path to domain mappings JSON file:",
            validate: (val) => (!val?.trim() ? "Path is required" : undefined),
          });
          if (clack.isCancel(mapPath)) break;
          try {
            const mappings = loadDomainMappings(mapPath.trim());
            let count = 0;
            await mutate((vault) => {
              count = applyDomainMappings(vault, mappings);
            });
            clack.log.success(`Applied ${count} domain mapping(s).`);
          } catch (err) {
            clack.log.error((err as Error).message);
          }
          break;
        }
        case "aegis-import": {
          const aegisPath = await clack.text({
            message: "Path to unencrypted Aegis JSON export:",
            validate: (val) => (!val?.trim() ? "Path is required" : undefined),
          });
          if (clack.isCancel(aegisPath)) break;
          try {
            await mutate(async (vault) => {
              await handleAegisImport(aegisPath.trim(), vault);
            });
            clack.log.success("Aegis FIDO import complete.");
          } catch (err) {
            clack.log.error((err as Error).message);
          }
          break;
        }
        case "check-hibp": {
          const proceed = await clack.confirm({
            message: "Query HIBP k-anonymity API (sends 5-char SHA-1 prefix only)?",
            initialValue: true,
          });
          if (clack.isCancel(proceed) || !proceed) break;

          const spin = clack.spinner();
          spin.start("Checking passwords against HIBP...");
          try {
            const compromisedCount = await detectCompromisedPasswords(vaultData);
            if (compromisedCount > 0) {
              spin.stop(style.yellow(`Found ${compromisedCount} compromised password(s)!`));
            } else {
              spin.stop(style.green("No compromised passwords found in HIBP."));
            }
          } catch (err) {
            spin.stop(style.red(`HIBP check failed: ${(err as Error).message}`));
          }
          break;
        }
        case "generate-password": {
          const lenStr = await clack.text({
            message: "Password length (min 12):",
            initialValue: "16",
            validate: (val) => {
              const n = Number(val);
              if (!Number.isInteger(n) || n < 12) return "Enter an integer >= 12";
              return undefined;
            },
          });
          if (clack.isCancel(lenStr)) break;
          const pw = generateStrongPassword(Number(lenStr) || 16);
          clack.note(style.bold(style.green(pw)), "Generated Strong Password");
          break;
        }
        case "export-report": {
          const reportPath = await clack.text({
            message: "Report output path (.json or .md):",
            initialValue: "vault-report.md",
            validate: (val) => (!val?.trim() ? "Path is required" : undefined),
          });
          if (clack.isCancel(reportPath)) break;
          const target = reportPath.trim();
          const { report, health } = buildInteractiveReport(vaultData, initialCount, initialScore);
          const content = target.toLowerCase().endsWith(".md")
            ? formatMarkdownReport(report, health)
            : JSON.stringify(report, null, 2);
          try {
            writeReportFile(target, content, "report", [
              { path: inputPath, label: "input vault" },
              { path: defaultOutputPath, label: "vault output" },
            ]);
            clack.log.success(`Exported report to ${target}`);
          } catch (err) {
            clack.log.error((err as Error).message);
          }
          break;
        }
        case "undo": {
          vaultData = undo(vaultData);
          dirty = true;
          clack.log.info("Undid last change.");
          break;
        }
        case "redo": {
          vaultData = redo(vaultData);
          dirty = true;
          clack.log.info("Redid change.");
          break;
        }
        case "save": {
          const target = await clack.text({
            message: "Output vault file path:",
            initialValue: defaultOutputPath || inputPath,
            validate: (val) => (!val?.trim() ? "Path is required" : undefined),
          });
          if (clack.isCancel(target)) break;
          const savePath = target.trim();
          if (saveOptions.dryRun) {
            clack.log.info(`Dry-run mode: nothing was written to "${savePath}".`);
            break;
          }
          if (fs.existsSync(savePath)) {
            const overwrite = await clack.confirm({
              message: `"${savePath}" already exists. Overwrite it?`,
              initialValue: false,
            });
            if (clack.isCancel(overwrite) || !overwrite) {
              clack.log.info("Save cancelled.");
              break;
            }
          }
          const spin = clack.spinner();
          spin.start(`Saving vault to ${savePath}...`);
          try {
            // Keep the source format (e.g. CSV stays CSV) instead of silently exporting Bitwarden JSON.
            const targetFormat = resolveInteractiveOutputFormat(
              savePath,
              parsedInput.format,
              outputFormat,
            );
            const saved = await writeInteractiveSave(
              vaultData,
              savePath,
              targetFormat,
              targetFormat === parsedInput.format ? parsedInput.rawMeta : undefined,
              saveOptions,
            );
            if (saved.backupPath) clack.log.info(`Backup created at ${saved.backupPath}`);
          } catch (err) {
            spin.stop(
              style.red(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
            );
            break;
          }
          dirty = false;
          spin.stop(`Saved vault to ${savePath}`);
          break;
        }
        case "exit": {
          if (dirty) {
            const confirmExit = await clack.confirm({
              message: "You have unsaved changes. Exit anyway?",
              initialValue: false,
            });
            if (clack.isCancel(confirmExit) || !confirmExit) break;
          }
          running = false;
          break;
        }
      }
    } catch (err) {
      // A failed action is rolled back by `mutate`; report it and keep the session (and unsaved work) alive.
      clack.log.error(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  clack.outro(`${BRAND_NAME} session closed.`);
}
