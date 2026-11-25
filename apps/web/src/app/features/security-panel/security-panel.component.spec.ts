import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import {
  matCheckCircleRound,
  matDevicesRound,
  matLinkRound,
  matRefreshRound,
  matSecurityRound,
} from "@ng-icons/material-symbols/round";
import { describe, expect, it } from "vitest";

import { SecurityPanelComponent } from "./security-panel.component";

describe("SecurityPanelComponent", () => {
  it("filters finding cards and renders individual weakness reason pills", () => {
    TestBed.configureTestingModule({
      imports: [SecurityPanelComponent],
      providers: [
        provideIcons({
          matCheckCircleRound,
          matDevicesRound,
          matLinkRound,
          matRefreshRound,
          matSecurityRound,
        }),
      ],
    });
    const fixture = TestBed.createComponent(SecurityPanelComponent);
    fixture.componentRef.setInput("weakItems", [
      {
        index: 0,
        item: { name: "Weak Login", login: { username: "alice", password: "123" } },
        reasons: ["too short", "missing digit"],
      },
    ]);
    fixture.componentRef.setInput("reusedGroups", [
      { items: [{ index: 1, item: { name: "Shared One" } }] },
    ]);
    fixture.componentRef.setInput("invalidUriItems", [
      { index: 2, item: { name: "Broken Site" }, invalidUris: ["not a url"] },
    ]);
    fixture.componentRef.setInput("healthScore", 60);
    fixture.componentRef.setInput("checkingHibp", false);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain("too short");
    expect(root.textContent).toContain("missing digit");
    expect(root.textContent).toContain("Weak Passwords (1)");
    expect(root.textContent).toContain("Reused Passwords (1 group)");
    expect(root.textContent).toContain("Invalid / Malformed URIs (1)");

    const clickFilter = (prefix: string) => {
      const btn = [...root.querySelectorAll("button")].find((b) =>
        b.textContent?.trim().startsWith(prefix),
      )!;
      btn.click();
      fixture.detectChanges();
      return btn;
    };

    const weakBtn = clickFilter("Weak (1)");
    expect(weakBtn.getAttribute("aria-pressed")).toBe("true");
    expect(root.textContent).toContain("Weak Passwords (1)");
    expect(root.textContent).not.toContain("Reused Passwords (1 group(s))");
    expect(root.textContent).not.toContain("Invalid / Malformed URIs (1)");

    const reusedBtn = clickFilter("Reused (1)");
    expect(reusedBtn.getAttribute("aria-pressed")).toBe("true");
    expect(root.textContent).not.toContain("Weak Passwords (1)");
    expect(root.textContent).toContain("Reused Passwords (1 group)");

    const urisBtn = clickFilter("Invalid URIs (1)");
    expect(urisBtn.getAttribute("aria-pressed")).toBe("true");
    expect(root.textContent).toContain("Invalid / Malformed URIs (1)");
    expect(root.textContent).not.toContain("Weak Passwords (1)");
  });
});
