import { describe, expect, test } from "bun:test";

import type { VaultData } from "@vaultlint/vault-schema";

import {
  buildVaultMigrationDecisionReport,
  mergeVaultMigration,
  previewVaultMigration,
} from "../src/migration";

describe("migration candidate collisions", () => {
  test("does not merge multiple selected incoming candidates into one existing item", () => {
    const current: VaultData = {
      items: [
        {
          id: "shared",
          name: "Existing account",
          type: 1,
          login: { username: "existing-user", uris: ["https://example.com"] },
        },
      ],
    };
    const incoming: VaultData = {
      items: [
        {
          id: "shared",
          name: "First import",
          type: 1,
          login: { username: "first-user", uris: ["https://example.com"] },
        },
        {
          id: "shared",
          name: "Second import",
          type: 1,
          login: { username: "second-user", uris: ["https://example.com"] },
        },
      ],
    };
    const preview = previewVaultMigration(current, incoming);
    expect(
      preview.candidates.map(({ currentIndex, incomingIndex }) => [currentIndex, incomingIndex]),
    ).toEqual([
      [0, 0],
      [0, 1],
    ]);

    const merged = mergeVaultMigration(current, incoming, {
      mergeCandidateIndices: [0, 1],
      defaultPreference: "incoming",
    });
    expect(merged.items.map((item) => item.name)).toEqual(["First import", "Second import"]);
    const report = buildVaultMigrationDecisionReport(preview, {
      mergeCandidateIndices: [0, 1],
      defaultPreference: "incoming",
    });
    expect(report.summary.candidatesMerged).toBe(1);
    expect(report.summary.itemsAdded).toBe(1);
    expect(report.decisions.map(({ action }) => action)).toEqual([
      "merged-candidate",
      "candidate-added",
    ]);
  });
});
