import { InjectionToken } from "@angular/core";

/** Abstraction over `localStorage` so services can be unit-tested without browser globals. */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const safeBrowserStorage: StorageAdapter = {
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Ignore storage errors in restricted environments.
    }
  },
  removeItem(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Ignore storage errors in restricted environments.
    }
  },
};

/** Angular DI token for key-value persistence. */
export const BROWSER_STORAGE = new InjectionToken<StorageAdapter>("BROWSER_STORAGE", {
  providedIn: "root",
  factory: () => safeBrowserStorage,
});
