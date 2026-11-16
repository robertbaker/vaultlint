import { describe, expect, test } from "bun:test";

import { redactUriCredentials } from "../src/uri";

describe("redactUriCredentials", () => {
  test("masks a password that contains a literal @ (userinfo ends at the last @)", () => {
    expect(redactUriCredentials("https://u:p@ss@host.com/x")).toBe("https://u:***@host.com/x");
    expect(redactUriCredentials("https://u:p@ss@host.com:8080/a@b")).toBe(
      "https://u:***@host.com:8080/a@b",
    );
  });

  test("still masks ordinary credentials and leaves credential-free URIs alone", () => {
    expect(redactUriCredentials("https://admin:S3cret@example.com/p")).toBe(
      "https://admin:***@example.com/p",
    );
    expect(redactUriCredentials("admin:S3cret@example.com")).toBe("admin:***@example.com");
    expect(redactUriCredentials("https://u@host.com/a:b@c")).toBe("https://u@host.com/a:b@c");
    expect(redactUriCredentials("https://host.com/?next=a:b@c")).toBe(
      "https://host.com/?next=a:b@c",
    );
    expect(redactUriCredentials("ssh://git@github.com:org/repo.git")).toBe(
      "ssh://git@github.com:org/repo.git",
    );
  });
});
