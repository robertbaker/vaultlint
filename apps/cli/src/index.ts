#!/usr/bin/env node
/** Main application entry point for vaultlint */

import { VAULT_FORMATS } from "@vaultlint/vault-formats";
import { LINT_RULES } from "@vaultlint/vault-ops";

import { setupCLI, getOptions, printPrivacyNotice, type CLIOptions } from "./cli";
import { runInteractiveCLI } from "./cliInteractive";
import { createCliStyle, isColorSupported, renderSection, renderTable } from "./cliUi";
import { getLintExitCode, runVaultEnhancement } from "./vaultManager";
import { generateStrongPassword } from "./vaultService";
import { describeVendorCliSupport, VENDOR_CLI_PROVIDERS } from "./vendorCli";
import { startWebUIServer } from "./webServer";

function hasActionFlag(options: CLIOptions): boolean {
  return Boolean(
    options.audit ||
    options.mergeInput ||
    options.checkRedirects ||
    options.fixRedirects ||
    options.lint ||
    options.fix ||
    options.stats ||
    options.list ||
    options.search ||
    options.filter ||
    options.detectDuplicates ||
    options.autoMerge ||
    options.batchEdit ||
    options.normalize ||
    options.aegisImport ||
    options.domainMappings ||
    options.checkWeakPasswords ||
    options.fixWeakPasswords ||
    options.checkReusedPasswords ||
    options.fixReusedPasswords ||
    options.checkUris ||
    options.checkCompromised ||
    options.validateMobileUris ||
    options.enableAI ||
    options.aiOrganize ||
    options.aiDuplicates ||
    options.aiSuggestUris ||
    options.aiHygiene ||
    options.exportReport ||
    options.sarif,
  );
}

async function main() {
  let noColor = false;
  let jsonMode = false;
  try {
    setupCLI(process.argv);
    const options = getOptions();
    noColor = Boolean(options.noColor);
    jsonMode = Boolean(options.json);
    const style = createCliStyle(!jsonMode && isColorSupported(noColor));

    if (options.listFormats) {
      if (jsonMode) {
        console.log(JSON.stringify(VAULT_FORMATS, null, 2));
      } else {
        const rows = VAULT_FORMATS.map((f) => [
          f.id,
          f.provider,
          f.extensions.join(", "),
          f.description,
        ]);
        console.log(renderSection(`Supported Vault Formats (${VAULT_FORMATS.length})`, style));
        console.log(
          renderTable(["Format ID", "Provider", "Extensions", "Description"], rows, { style }),
        );
      }
      return;
    }

    if (options.listCliProviders) {
      const rows = Object.values(VENDOR_CLI_PROVIDERS).map((p) => {
        const support = describeVendorCliSupport(p);
        return [p.id, p.binary, support.read ? "yes" : "no", support.write ? "yes" : "no"];
      });
      if (jsonMode) {
        console.log(
          JSON.stringify(
            Object.values(VENDOR_CLI_PROVIDERS).map((p) => ({
              id: p.id,
              binary: p.binary,
              ...describeVendorCliSupport(p),
              unsupportedReason: p.unsupportedReason,
            })),
            null,
            2,
          ),
        );
      } else {
        console.log(renderSection("Vendor CLI Providers", style));
        console.log(renderTable(["Provider", "Binary", "Import", "Push"], rows, { style }));
      }
      return;
    }

    if (options.listRules) {
      if (jsonMode) {
        console.log(JSON.stringify(LINT_RULES, null, 2));
      } else {
        const rows = LINT_RULES.map((r) => [
          r.id,
          r.category,
          r.defaultSeverity,
          r.fixable ? r.fixable : "no",
          r.description,
        ]);
        console.log(renderSection(`Lint Rules (${LINT_RULES.length})`, style));
        console.log(
          renderTable(["Rule ID", "Category", "Default", "Autofix", "Description"], rows, {
            maxColWidth: 52,
            style,
          }),
        );
      }
      return;
    }

    if (options.generatePassword !== undefined) {
      const pw = generateStrongPassword(options.generatePassword);
      if (jsonMode) {
        console.log(JSON.stringify({ password: pw, length: pw.length }, null, 2));
      } else {
        console.log(pw);
      }
      return;
    }

    if (!jsonMode && !options.quiet && !options.interactive) {
      printPrivacyNotice(noColor);
    }

    if (options.ui) {
      await startWebUIServer(options.port || 4173);
      return;
    }

    if (options.interactive) {
      if (options.fromCli) {
        throw new Error("--interactive cannot be combined with --from-cli.");
      }
      await runInteractiveCLI(
        options.input,
        options.output,
        noColor,
        options.inputFormat,
        options.outputFormat,
        { dryRun: options.dryRun, backup: options.backup },
      );
      return;
    }

    const report = await runVaultEnhancement(options);

    if (getLintExitCode(options, report) !== 0) {
      process.exitCode = 1;
    }

    if (!hasActionFlag(options) && !jsonMode && !options.quiet) {
      console.log(
        style.dim(
          "Tip: Run with --audit for a full health check, --list to browse items, --interactive for menu mode, or --help for all options.",
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jsonMode) {
      console.error(JSON.stringify({ error: message }, null, 2));
    } else {
      const style = createCliStyle(isColorSupported(noColor));
      console.error(`${style.red("✖ Error:")} ${message}`);
    }
    process.exitCode = 1;
  }
}

main();
