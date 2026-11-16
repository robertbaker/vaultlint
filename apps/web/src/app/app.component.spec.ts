import { TestBed } from "@angular/core/testing";
import { buildVaultItemRefs } from "@vaultlint/vault-schema";

import { App } from "./app";
import { VaultStoreService } from "./core/vault-store.service";

interface AppInternals {
  searchQuery: { set(v: string): void; (): string };
  filterMode: { set(v: string): void; (): string };
  typeFilter: { set(v: string): void; (): string };
  folderFilter: { set(v: string): void; (): string };
  locateEditedItem(result: { index: number; original: unknown }): number;
  onDeleteRequested(row: { index: number; key: string; item: unknown; name: string }): void;
  onConfirmResolved(confirmed: boolean): void;
  activeSection(): { id: string };
}

describe("App", () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [App] }));

  it("resets search and filters whenever the open vault is replaced or cleared", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    fixture.detectChanges();
    await fixture.whenStable();

    app.searchQuery.set("google");
    app.filterMode.set("weak");
    app.typeFilter.set("login");
    app.folderFilter.set("f-work");
    fixture.detectChanges();
    expect(app.searchQuery()).toBe("google");

    await store.loadSampleVault();
    fixture.detectChanges();
    expect(app.searchQuery()).toBe("");
    expect(app.filterMode()).toBe("all");
    expect(app.typeFilter()).toBe("all");
    expect(app.folderFilter()).toBe("all");

    app.searchQuery.set("again");
    app.filterMode.set("reused");
    store.clearVault();
    fixture.detectChanges();
    expect(app.searchQuery()).toBe("");
    expect(app.filterMode()).toBe("all");
  });

  it("switches workspace sections with number keys only when it is safe to", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    const press = (key: string, init: KeyboardEventInit = {}) =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

    press("2");
    expect(app.activeSection()?.id ?? "items").toBe("items");

    await store.loadSampleVault();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(app.activeSection().id).toBe("items");

    press("2", { ctrlKey: true });
    expect(app.activeSection().id).toBe("items");

    press("3");
    expect(app.activeSection().id).toBe("organize");
    press("5");
    expect(app.activeSection().id).toBe("activity");
    press("9");
    expect(app.activeSection().id).toBe("activity");
    press("1");
    expect(app.activeSection().id).toBe("items");

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    press("2");
    expect(app.activeSection().id).toBe("items");
    input.remove();
  });

  it("does not reset filters for ordinary edits that keep the same vault", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    fixture.detectChanges();

    app.searchQuery.set("google");
    store.deleteItem(3);
    fixture.detectChanges();
    expect(app.searchQuery()).toBe("google");
  });

  it("re-locates the edited item by id or content when indices shifted", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const github = structuredClone(store.vaultData()!.items[2]);

    store.deleteItem(0); // GitHub shifts from 2 to 1
    expect(app.locateEditedItem({ index: 2, original: github })).toBe(1);

    store.deleteItem(1); // GitHub removed
    expect(app.locateEditedItem({ index: 1, original: github })).toBe(-1);

    const idless = { name: "Loose", login: { username: "u" } };
    await store.loadVaultObject({ items: [{ name: "X" }, idless] }, "idless.json");
    store.deleteItem(0);
    expect(app.locateEditedItem({ index: 1, original: idless })).toBe(0);
  });

  it("re-locates the intended item if the list shifts while deletion is confirmed", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const data = store.vaultData()!;
    app.onDeleteRequested({
      index: 2,
      key: buildVaultItemRefs(data)[2],
      item: data.items[2],
      name: data.items[2].name ?? "",
    });

    store.deleteItem(0);
    app.onConfirmResolved(true);

    const names = store.vaultData()!.items.map((item) => item.name);
    expect(names).not.toContain("GitHub");
    expect(names).toContain("Netflix");
  });

  it("cancels deletion if the selected item changes before confirmation", async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as AppInternals;
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const data = store.vaultData()!;
    const selected = data.items[2];
    app.onDeleteRequested({
      index: 2,
      key: buildVaultItemRefs(data)[2],
      item: selected,
      name: selected.name ?? "",
    });

    store.updateItem(2, {
      name: "Edited GitHub",
      username: selected.login?.username ?? "",
      password: selected.login?.password ?? "",
      urisText: "https://github.com",
      notes: selected.notes ?? "",
    });
    app.onConfirmResolved(true);

    expect(store.totalItems()).toBe(4);
    expect(store.vaultData()!.items[2].name).toBe("Edited GitHub");
    expect(store.auditLog()[0]?.action).toContain("changed while confirming deletion");
  });
});
