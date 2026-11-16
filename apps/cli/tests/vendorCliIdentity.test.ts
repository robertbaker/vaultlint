import { describe, expect, it } from "bun:test";

import { diffBitwardenVaults } from "../src/vendorCli/bitwarden";

describe("Bitwarden push identity safety", () => {
  it("refuses to plan pushes when item IDs are duplicated", () => {
    const duplicateItems = [
      { id: "same-id", name: "First", login: { password: "first" } },
      { id: "same-id", name: "Second", login: { password: "second" } },
    ];
    expect(() => diffBitwardenVaults({ items: duplicateItems }, { items: [] })).toThrow(
      /original vault contains duplicate item IDs/,
    );
    expect(() => diffBitwardenVaults({ items: [] }, { items: duplicateItems })).toThrow(
      /updated vault contains duplicate item IDs/,
    );
  });
});
