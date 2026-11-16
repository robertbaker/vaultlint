import { describe, expect, it, spyOn } from "bun:test";

import { VaultData } from "@vaultlint/vault-schema";

import { findAndMergeDuplicates, findDuplicateGroups } from "../src/duplicateService";

describe("Duplicate Service", () => {
  it("should find and merge duplicates in the vault", async () => {
    const vaultData: VaultData = {
      items: [
        {
          name: "google.com",
          login: { uris: ["https://google.com"] },
          lastModified: "2022-01-01",
        },
        {
          name: "google.com",
          login: { uris: ["https://www.google.com"] },
          lastModified: "2022-01-02",
        },
      ],
    };

    await findAndMergeDuplicates(vaultData);

    expect(vaultData.items).toHaveLength(1);
    expect(vaultData.items[0].login!.uris).toContain("https://google.com");
    expect(vaultData.items[0].login!.uris).toContain("https://www.google.com");
  });

  it("preserves path-specific login URIs when merging duplicate names", async () => {
    const vaultData: VaultData = {
      items: [
        { name: "Example", login: { uris: ["https://example.com/login"] } },
        { name: "example", login: { uris: ["https://example.com/admin"] } },
      ],
    };

    await findAndMergeDuplicates(vaultData);

    expect(vaultData.items).toHaveLength(1);
    expect(vaultData.items[0].login?.uris).toEqual([
      "https://example.com/login",
      "https://example.com/admin",
    ]);
  });

  it("preserves distinct URI match modes for the same URL", async () => {
    const uri = "https://example.com";
    const vaultData: VaultData = {
      items: [
        { name: "Example", login: { uris: [{ uri, match: 3 }] } },
        { name: "example", login: { uris: [{ uri, match: 0 }] } },
      ],
    };

    await findAndMergeDuplicates(vaultData);

    expect(vaultData.items).toHaveLength(1);
    expect(vaultData.items[0].login?.uris).toEqual([
      { uri, match: 3 },
      { uri, match: 0 },
    ]);
  });

  it("preserves card, custom field, history, and collection data when merging", async () => {
    const vaultData: VaultData = {
      items: [
        {
          id: "one",
          name: "Example",
          type: 3,
          card: { brand: "Visa" },
          fields: [{ name: "A", value: "1" }],
        },
        {
          id: "two",
          name: "example",
          type: 3,
          card: { number: "4111111111111111" },
          fields: [{ name: "B", value: "2" }],
          passwordHistory: [{ password: "old", lastUsedDate: null }],
          collectionIds: ["collection-1"],
        },
      ],
    };

    await findAndMergeDuplicates(vaultData);

    expect(vaultData.items).toHaveLength(1);
    expect(vaultData.items[0].card).toEqual({ brand: "Visa", number: "4111111111111111" });
    expect(vaultData.items[0].fields).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "2" },
    ]);
    expect(vaultData.items[0].passwordHistory).toEqual([{ password: "old", lastUsedDate: null }]);
    expect(vaultData.items[0].collectionIds).toEqual(["collection-1"]);
  });

  it("should safely merge items missing lastModified or login without throwing", async () => {
    const vaultData: VaultData = {
      items: [
        { id: "1", name: "Example" },
        { id: "2", name: "example", login: { uris: [{ uri: "https://example.com" }] } },
        { id: "3" },
        { id: "4" },
      ],
    };

    const merged = await findAndMergeDuplicates(vaultData);
    expect(merged).toBe(1);
    expect(vaultData.items).toHaveLength(3); // Example + 2 distinct unnamed items
    expect(vaultData.items[0].login!.uris).toEqual([{ uri: "https://example.com" }]);
  });

  it("preserves prototype-like names and isolates unnamed entries during merges", async () => {
    const vaultData: VaultData = {
      items: [
        { id: "proto-1", name: "__proto__", notes: "first" },
        { id: "constructor-1", name: "constructor", notes: "constructor" },
        { id: "1" },
        { id: "named", name: "__unnamed_1", notes: "named" },
        { id: "proto-2", name: "__PROTO__", login: { username: "kept" } },
        { id: "constructor-2", name: "CONSTRUCTOR", login: { username: "also kept" } },
      ],
    };

    const merged = await findAndMergeDuplicates(vaultData);

    expect(merged).toBe(2);
    expect(vaultData.items).toHaveLength(4);
    expect(vaultData.items.map((item) => item.name)).toEqual([
      "__proto__",
      "constructor",
      undefined,
      "__unnamed_1",
    ]);
    expect(vaultData.items[0].login?.username).toBe("kept");
    expect(vaultData.items[1].login?.username).toBe("also kept");
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "login")).toBe(false);
  });

  it("keeps a duplicate item if its fields cannot be merged", async () => {
    const malformed = {
      id: "broken",
      name: "Example",
      login: { uris: {} },
    } as unknown as VaultData["items"][number];
    const vaultData: VaultData = {
      items: [{ id: "valid", name: "Example" }, malformed],
    };

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const merged = await findAndMergeDuplicates(vaultData);
      expect(merged).toBe(0);
      expect(vaultData.items).toHaveLength(2);
      expect(vaultData.items[1]).toBe(malformed);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not auto-merge same-name items of different types", async () => {
    const vaultData: VaultData = {
      items: [
        { id: "login", name: "Work", type: 1, login: { username: "alice" } },
        { id: "card", name: "work", type: 3, card: { number: "4111111111111111" } },
      ],
    };

    const merged = await findAndMergeDuplicates(vaultData);

    expect(merged).toBe(0);
    expect(vaultData.items).toHaveLength(2);
    expect(vaultData.items[1].card?.number).toBe("4111111111111111");
  });

  it("should flag different usernames, passwords, and subdomains in duplicate groups", () => {
    const vaultData: VaultData = {
      items: [
        {
          name: "Google",
          login: {
            username: "alice@gmail.com",
            password: "PasswordOne1!",
            uris: [{ uri: "https://mail.google.com" }],
          },
        },
        {
          name: "google",
          login: {
            username: "bob@gmail.com",
            password: "PasswordTwo2!",
            uris: [{ uri: "https://drive.google.com" }],
          },
        },
      ],
    };

    const groups = findDuplicateGroups(vaultData);
    expect(groups).toHaveLength(1);
    expect(groups[0].conflicts.hasDifferentUsernames).toBe(true);
    expect(groups[0].conflicts.hasDifferentPasswords).toBe(true);
    expect(groups[0].conflicts.hasDifferentSubdomains).toBe(true);
    expect(groups[0].conflicts.distinctHostnames).toEqual(["mail.google.com", "drive.google.com"]);
  });
});
