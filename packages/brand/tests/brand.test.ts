import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { BRAND_THEME_COLOR, formatList, TRADEMARK_NOTICE } from "../src/index";

describe("brand", () => {
  test("formatList uses an Oxford comma", () => {
    expect(formatList([])).toBe("");
    expect(formatList(["A"])).toBe("A");
    expect(formatList(["A", "B"], "or")).toBe("A or B");
    expect(formatList(["A", "B", "C"])).toBe("A, B, and C");
  });

  test("trademark notice names every owner", () => {
    expect(TRADEMARK_NOTICE).toContain("Brave Software, or Apple.");
  });

  test("tokens.css defines every semantic token with light-dark()", () => {
    const css = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    for (const token of ["--background", "--foreground", "--primary", "--muted-foreground"]) {
      expect(css).toMatch(new RegExp(`${token}: light-dark\\(`));
    }
    expect(css).toContain(':root[data-theme="dark"]');
    expect(BRAND_THEME_COLOR.dark).toBe("#0b1220");
  });
});
