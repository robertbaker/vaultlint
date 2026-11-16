import { describe, expect, test } from "bun:test";

import { redactSecrets } from "../src/vendorCli/runner";

describe("vendor CLI secret redaction", () => {
  test("redacts 1Password, Keeper and other credential env values, not only the Bitwarden ones", () => {
    const env = {
      OP_SERVICE_ACCOUNT_TOKEN: "ops_TOKEN_abcdef",
      OP_SESSION_myaccount: "OPSESSIONVALUE1",
      OP_CONNECT_TOKEN: "connect-token-123",
      KEEPER_PASSWORD: "keeperPassw0rd",
      LPASS_AGENT_TIMEOUT: "3600",
      SESSIONNAME: "Console",
      USERNAME: "someone",
    };
    const text =
      "failed: ops_TOKEN_abcdef OPSESSIONVALUE1 connect-token-123 keeperPassw0rd Console 3600 someone";
    const out = redactSecrets(text, env);
    for (const secret of [
      "ops_TOKEN_abcdef",
      "OPSESSIONVALUE1",
      "connect-token-123",
      "keeperPassw0rd",
    ]) {
      expect(out).not.toContain(secret);
    }
    // Non-secret environment values are left readable.
    expect(out).toContain("Console");
    expect(out).toContain("3600");
    expect(out).toContain("someone");
  });

  test("still redacts the explicit Bitwarden session key", () => {
    expect(redactSecrets("x KEY123 y", { BW_SESSION: "KEY123" })).toBe("x [redacted BW_SESSION] y");
  });
});
