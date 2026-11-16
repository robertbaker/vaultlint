import { describe, expect, test } from "bun:test";

import { extractDomainParts, getSafeUriDisplayLabel } from "../src/index";

describe("getSafeUriDisplayLabel", () => {
  test("keeps only hostname and port, stripping credentials and URI contents", () => {
    expect(
      getSafeUriDisplayLabel("https://alice:secret@example.com:8443/private/path?token=abc#frag"),
    ).toBe("example.com:8443");
  });

  test("does not echo malformed or opaque URI contents", () => {
    expect(getSafeUriDisplayLabel("not a uri?token=secret")).toBe("(invalid URI)");
    expect(getSafeUriDisplayLabel("mailto:alice@example.com")).toBe("(invalid URI)");
  });
});

describe("extractDomainParts", () => {
  test("IPv4 literals have no registrable domain or subdomain", () => {
    expect(extractDomainParts("http://192.168.1.5:8080/x")).toEqual({
      hostname: "192.168.1.5",
      domainTld: "192.168.1.5",
      subDomain: "",
    });
  });

  test("still splits regular and two-part-TLD hostnames", () => {
    expect(extractDomainParts("https://a.b.example.co.uk")).toEqual({
      hostname: "a.b.example.co.uk",
      domainTld: "example.co.uk",
      subDomain: "a.b",
    });
  });

  test("does not treat email addresses in non-web URIs as hostnames", () => {
    expect(extractDomainParts("mailto:user@accounts.shop.example.co.uk")).toEqual({
      hostname: "",
      domainTld: "",
      subDomain: "",
    });
    expect(extractDomainParts("tel:+1-555-0100")).toEqual({
      hostname: "",
      domainTld: "",
      subDomain: "",
    });
  });

  test("parses scheme-less hosts with explicit ports", () => {
    expect(extractDomainParts("example.com:8443/path")).toEqual({
      hostname: "example.com",
      domainTld: "example.com",
      subDomain: "",
    });
    expect(extractDomainParts("localhost:3000")).toEqual({
      hostname: "localhost",
      domainTld: "localhost",
      subDomain: "",
    });
  });
});
