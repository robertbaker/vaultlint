import { TestBed } from "@angular/core/testing";
import type { VaultItem } from "@vaultlint/vault-schema";
import { describe, expect, it } from "vitest";

import type { DuplicateGroup } from "../../core/vault.models";
import { DuplicatesPanelComponent } from "./duplicates-panel.component";

function entry(index: number, extra: Partial<VaultItem>) {
  const item: VaultItem = {
    id: String(index),
    name: "Gamma",
    login: { username: "g", password: "x", uris: [] },
    ...extra,
  };
  return { item, index };
}

describe("DuplicatesPanelComponent", () => {
  it("shows the revision date of entries that only carry revisionDate", () => {
    // Merging picks the newest entry from lastModified ?? revisionDate, so the panel must show the
    // same date instead of "no date" for Bitwarden exports.
    const group: DuplicateGroup = {
      key: "gamma",
      name: "Gamma",
      items: [
        entry(0, { revisionDate: "2020-01-01T00:00:00.000Z" }),
        entry(1, { revisionDate: "2024-01-01T00:00:00.000Z" }),
        entry(2, {}),
      ],
      uris: [],
      conflicts: {
        hasDifferentUsernames: false,
        hasDifferentPasswords: false,
        hasDifferentSubdomains: false,
        distinctUsernames: [],
        distinctHostnames: [],
      },
    };
    TestBed.configureTestingModule({ imports: [DuplicatesPanelComponent] });
    const fixture = TestBed.createComponent(DuplicatesPanelComponent);
    fixture.componentRef.setInput("groups", [group]);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("2020-01-01T00:00:00.000Z");
    expect(text).toContain("2024-01-01T00:00:00.000Z");
    expect(text.match(/no date/g)).toHaveLength(1);
  });
});
