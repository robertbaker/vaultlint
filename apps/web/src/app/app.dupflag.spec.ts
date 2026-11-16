import { TestBed } from "@angular/core/testing";

import { App } from "./app";
import { VaultStoreService } from "./core/vault-store.service";

describe("Explorer duplicate filter", () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [App] }));

  it("flags only items that belong to a real duplicate group (same type + name)", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      filterMode: { set(v: string): void };
      filteredRows: () => Array<{ item: { id: string } }>;
    };
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject({
      encrypted: false,
      folders: [],
      items: [
        { id: "a", type: 1, name: "Amazon", login: { username: "u1" } },
        { id: "b", type: 1, name: "Amazon", login: { username: "u2" } },
        { id: "c", type: 3, name: "Amazon", card: { number: "4111" } },
      ],
    });
    fixture.detectChanges();
    app.filterMode.set("duplicate");
    fixture.detectChanges();
    expect(app.filteredRows().map((r) => r.item.id)).toEqual(["a", "b"]);
  });
});
