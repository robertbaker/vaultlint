import { describe, expect, it } from "bun:test";

import { createCliStyle, renderTable, stripAnsi } from "../src/cliUi";

describe("CLI output sanitization", () => {
  it("removes terminal escape sequences and control characters from table cells", () => {
    const rendered = renderTable(
      ["Item"],
      [["Login\u001b[2J\u001b]0;Injected title\u0007\nInjected row"]],
      { style: createCliStyle(false) },
    );

    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("\u0007");
    expect(rendered).toContain("Login Injected row");
    expect(stripAnsi("safe\u001b[31mtext\u001b[0m")).toBe("safetext");
  });
});
