import { describe, expect, test } from "bun:test";

import { checkVaultPasswordsHibp } from "../src/password";

async function sha1Parts(value: string): Promise<{ prefix: string; suffix: string }> {
  const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

describe("HIBP item references", () => {
  test("does not alias an id-less item's position with another item's ID", async () => {
    const breached = await sha1Parts("breached");
    const vault = {
      items: [
        { id: "1", name: "ID at position zero", login: { password: "safe-password" } },
        { name: "ID-less at position one", login: { password: "breached" } },
      ],
    };

    const found = await checkVaultPasswordsHibp(vault, async (input) => {
      const prefix = new URL(String(input)).pathname.split("/").at(-1);
      const suffix = prefix === breached.prefix ? breached.suffix : "0".repeat(35);
      return new Response(`${suffix}:1`);
    });

    expect(found).toEqual(new Set(["index:1"]));
  });
});
