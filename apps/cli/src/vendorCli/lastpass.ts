import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "lpass";

export const lastpassProvider: VendorCliProvider = {
  id: "lastpass",
  displayName: "LastPass",
  binary: BIN,
  unsupportedReason: {
    write:
      "`lpass export` does not include entry IDs, so edits cannot be matched back to live entries safely.",
  },

  async ensureReady(runner: CommandRunner) {
    const result = await runner.run(BIN, ["status", "--quiet"]);
    if (result.code !== 0) {
      throw new Error(
        "You are not logged in to the LastPass CLI. Run `lpass login <username>` first. vaultlint never asks for your master password.",
      );
    }
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    // CSV goes straight to memory; vaultlint never writes it to disk.
    const content = await runChecked(runner, BIN, ["export", "--sync=now"]);
    // `lpass export` always prints a CSV header, even for an empty vault. Anything else (empty
    // output, an HTML/error page) must not be imported as a legitimately empty vault.
    const firstLine = content.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
    const columns = firstLine.split(",").map((column) => column.trim().toLowerCase());
    if (!columns.includes("url") || !columns.includes("password")) {
      throw new Error(
        "The LastPass CLI output was not a recognizable LastPass export (expected a CSV header with url and password columns); no audit was started.",
      );
    }
    return { content, format: "lastpass-csv" };
  },
};
