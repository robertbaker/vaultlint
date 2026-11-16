import { describe, expect, test } from "bun:test";

import { parseCsv, parseCsvRecords } from "../src/csv";

describe("CSV parser validation", () => {
  test("preserves escaped quotes and allows whitespace after quoted fields", () => {
    expect(parseCsv('name,note\nGitHub,"A ""quoted"" note"  \n').rows).toEqual([
      ["GitHub", 'A "quoted" note'],
    ]);
  });

  test("rejects malformed quote syntax instead of shifting or joining records", () => {
    expect(() => parseCsv('name,note\nGitHub,unfinished"quote\nNext,record')).toThrow(
      /quote inside an unquoted field/,
    );
    expect(() => parseCsv('name,note\nGitHub,"unfinished\nNext,record')).toThrow(
      /unterminated quoted field/,
    );
    expect(() => parseCsv('name,note\nGitHub,"closed"junk')).toThrow(
      /unexpected character after a quoted field/,
    );
  });

  test("preserves CSV columns named after prototype properties", () => {
    const { records } = parseCsvRecords("__proto__,constructor\npayload,header\n");
    expect(records[0]["__proto__"]).toBe("payload");
    expect(records[0].constructor).toBe("header");
    expect(Object.getPrototypeOf(records[0])).toBeNull();
  });
});
