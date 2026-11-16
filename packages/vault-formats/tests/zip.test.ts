import { describe, expect, test } from "bun:test";

import { createZipArchive, readZipEntries, readZipEntriesSync } from "../src/zip";

describe("ZIP archive validation", () => {
  test("allows EOCD-shaped bytes inside a valid archive comment", () => {
    const archive = createZipArchive({ "export.data": "valid" }).slice();
    const eocdOffset = archive.length - 22;
    const comment = new Uint8Array(40);
    comment.set(new TextEncoder().encode("note"), 0);
    comment.set([0x50, 0x4b, 0x05, 0x06], 4);
    comment.set(new TextEncoder().encode("trailing comment bytes"), 8);

    const withComment = new Uint8Array(archive.length + comment.length);
    withComment.set(archive);
    new DataView(withComment.buffer).setUint16(eocdOffset + 20, comment.length, true);
    withComment.set(comment, archive.length);

    expect(new TextDecoder().decode(readZipEntriesSync(withComment).get("export.data"))).toBe(
      "valid",
    );
  });

  test("round-trips stored entries and validates CRCs", () => {
    const archive = createZipArchive({ "export.data": '{"accounts":[]}' });
    expect(new TextDecoder().decode(readZipEntriesSync(archive).get("export.data"))).toBe(
      '{"accounts":[]}',
    );

    const corrupted = archive.slice();
    const centralOffset = new DataView(corrupted.buffer).getUint32(corrupted.length - 6, true);
    corrupted[centralOffset + 16] ^= 0xff;
    expect(() => readZipEntriesSync(corrupted)).toThrow(/CRC check failed/);
  });

  test("rejects out-of-bounds central directory and oversized entries", () => {
    const archive = createZipArchive({ "export.data": "{}" });

    const badOffset = archive.slice();
    new DataView(badOffset.buffer).setUint32(badOffset.length - 6, 0xfffffff0, true);
    expect(() => readZipEntriesSync(badOffset)).toThrow(/unsupported ZIP archive structure/);

    const oversizedEntry = archive.slice();
    const centralOffset = new DataView(oversizedEntry.buffer).getUint32(
      oversizedEntry.length - 6,
      true,
    );
    new DataView(oversizedEntry.buffer).setUint32(centralOffset + 24, 0xffffffff, true);
    expect(() => readZipEntriesSync(oversizedEntry)).toThrow(/maximum supported size/);
  });

  test("rejects duplicate entry names and invalid local headers", () => {
    const archive = createZipArchive({ item1: "a", item2: "b" });
    const view = new DataView(archive.buffer);
    const centralOffset = view.getUint32(archive.length - 6, true);
    const firstNameLength = view.getUint16(centralOffset + 28, true);
    const secondCentralOffset = centralOffset + 46 + firstNameLength;
    const secondNameLength = view.getUint16(secondCentralOffset + 28, true);
    archive.set(
      archive.subarray(centralOffset + 46, centralOffset + 46 + firstNameLength),
      secondCentralOffset + 46,
    );
    new DataView(archive.buffer).setUint16(secondCentralOffset + 28, firstNameLength, true);
    // Keep the second entry structurally valid while forcing a duplicate decoded filename.
    if (firstNameLength !== secondNameLength)
      throw new Error("Test fixture names must have equal length.");
    expect(() => readZipEntriesSync(archive)).toThrow(/Duplicate ZIP entry name/);

    const badHeader = createZipArchive({ first: "a" });
    badHeader[0] = 0;
    expect(() => readZipEntriesSync(badHeader)).toThrow(/Invalid ZIP local header/);
  });

  test("async reader applies the same structural and integrity checks", async () => {
    const archive = createZipArchive({ "export.data": "{}" });
    expect(await readZipEntries(archive)).toBeInstanceOf(Map);
    const nameLength = new DataView(archive.buffer).getUint16(26, true);
    archive[30 + nameLength] ^= 0xff;
    await expect(readZipEntries(archive)).rejects.toThrow(/CRC check failed/);
  });
});
