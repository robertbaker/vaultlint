import { describe, expect, test } from "bun:test";

import { buildVaultItemRefs } from "../src/index";

describe("buildVaultItemRefs", () => {
  test("avoids collisions between IDs and positional references", () => {
    const refs = buildVaultItemRefs({
      items: [
        { id: "1", name: "Has an ID" },
        { name: "ID-less at the same numeric position" },
        { id: "duplicate", name: "Duplicate A" },
        { id: "duplicate", name: "Duplicate B" },
        { id: "index:4", name: "Mimics a fallback" },
      ],
    });

    expect(refs).toEqual(["1", "index:1", "index:2", "index:3", "index:4"]);
    expect(new Set(refs).size).toBe(refs.length);
  });
});
