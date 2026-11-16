import { describe, expect, test } from "bun:test";

import { previewBatchEdits } from "../src/batchService";

describe("batch edit preview", () => {
  test("masks URL-embedded credentials in before/after when editing URIs", () => {
    const vault = {
      items: [
        {
          id: "1",
          name: "Svc",
          type: 1,
          login: { uris: [{ uri: "https://admin:S3cretPW@example.com/path" }] },
        },
      ],
    };
    const previews = previewBatchEdits(vault, "example", "example2", "uri");
    expect(previews).toHaveLength(1);
    expect(JSON.stringify(previews)).not.toContain("S3cretPW");
    expect(previews[0].before).toBe("https://admin:***@example.com/path");
    expect(previews[0].after).toBe("https://admin:***@example2.com/path");
  });

  test("does not alter non-URI previews", () => {
    const vault = { items: [{ id: "1", name: "a:b@c", type: 1 }] };
    expect(previewBatchEdits(vault, "a", "z", "name")[0].before).toBe("a:b@c");
  });
});
