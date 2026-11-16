import { DOCUMENT, effect, inject, Injectable, signal } from "@angular/core";

import { BROWSER_STORAGE } from "./storage.token";
import type { ThemeMode } from "./vault.models";

const THEME_STORAGE_KEY = "bw-theme";

function parseThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" ? value : "auto";
}

/**
 * Manages the active color-scheme preference (`auto` | `light` | `dark`), synchronizing
 * `meta[name="color-scheme"]`, root theme attributes, `localStorage`, and cross-tab storage
 * events.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = inject(BROWSER_STORAGE);

  private readonly _theme = signal<ThemeMode>(
    parseThemeMode(this.storage.getItem(THEME_STORAGE_KEY)),
  );
  readonly theme = this._theme.asReadonly();

  constructor() {
    effect(() => {
      this.applyToDocument(this._theme());
    });
  }

  setTheme(mode: ThemeMode): void {
    this._theme.set(mode);
    if (mode === "auto") {
      this.storage.removeItem(THEME_STORAGE_KEY);
    } else {
      this.storage.setItem(THEME_STORAGE_KEY, mode);
    }
  }

  syncFromStorageEvent(event: StorageEvent): void {
    if (event.key !== THEME_STORAGE_KEY) return;
    this._theme.set(parseThemeMode(event.newValue));
  }

  private applyToDocument(mode: ThemeMode): void {
    const root = this.document.documentElement;
    const meta = this.document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (meta) {
      meta.content = mode === "auto" ? "light dark" : mode;
    }

    if (mode === "auto") {
      root.removeAttribute("data-theme");
      root.classList.remove("dark");
    } else {
      root.setAttribute("data-theme", mode);
      root.classList.toggle("dark", mode === "dark");
    }
  }
}
