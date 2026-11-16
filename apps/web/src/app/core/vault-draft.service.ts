import { effect, inject, Injectable, signal } from "@angular/core";

import { BROWSER_STORAGE } from "./storage.token";
import { VaultStoreService, type VaultRecoverySnapshot } from "./vault-store.service";

interface EncryptedVaultDraft {
  key: CryptoKey;
  iv: number[];
  ciphertext: ArrayBuffer;
  savedAt: string;
}

type DraftSaveState = "checking" | "off" | "saving" | "saved" | "empty" | "error";

const DATABASE_NAME = "vaultlint-local-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";
/** LocalStorage key for the opt-in preference. Holds only "1" or "0", never vault data. */
export const RECOVERY_PREF_KEY = "vaultlint-recovery-copy";
/** A recovery copy that has not been refreshed for this long is deleted instead of offered. */
export const DRAFT_TTL_MS = 8 * 60 * 60 * 1000;

/*
 * SECURITY NOTE (limitations of the local recovery copy)
 *
 * The recovery draft holds the open vault, including plaintext passwords, encrypted with AES-GCM.
 * The AES key is generated per save as a NON-EXTRACTABLE CryptoKey and stored in the same
 * IndexedDB record as the ciphertext. That is deliberate (there is no user passphrase to derive a
 * key from, and nothing secret may live in localStorage), but it means the encryption is only
 * obfuscation against casual inspection of the browser profile on disk: any script running on this
 * origin, or anyone using this unlocked browser profile, can call decrypt() with the stored key.
 * It does NOT protect against a compromised origin, malicious extensions, or someone with access
 * to the signed-in browser profile.
 *
 * The recovery copy is OPT-IN (off by default); nothing is written to IndexedDB until the user
 * turns it on, and turning it off deletes any stored copy.
 *
 * Mitigations that are in place: the key cannot be exported as bytes; the copy expires after
 * DRAFT_TTL_MS without edits (checked on startup and on restore); it is deleted when the vault is
 * cleared, can be discarded from the UI at any time, and is replaced whenever a new vault loads.
 * Users on shared machines should clear the vault (or discard the recovery copy) before leaving.
 * See "Local recovery copy" in docs/USER_GUIDE.md.
 */

@Injectable({ providedIn: "root" })
export class VaultDraftService {
  private readonly store = inject(VaultStoreService);
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly ready = signal(false);
  private activeVault = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();

  /** Opt-in preference (default off). Persisted as a boolean only. */
  readonly enabled = signal(this.readPreference());
  readonly supported = this.isSupported();
  readonly hasDraft = signal(false);
  readonly savedAt = signal<string | null>(null);
  readonly saveState = signal<DraftSaveState>("checking");

  constructor() {
    effect(() => {
      const ready = this.ready();
      const enabled = this.enabled();
      const snapshot = enabled ? this.store.getRecoverySnapshot() : null;
      if (!ready) return;
      if (!enabled) {
        // setEnabled(false) owns the deletion; bumping the revision here could cancel it.
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        return;
      }

      const revision = ++this.revision;
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = null;

      if (!snapshot) {
        // Disabling is handled by setEnabled(false), which deletes the stored copy.
        if (this.activeVault && enabled) {
          this.activeVault = false;
          this.enqueueDelete(revision).catch(() => this.saveState.set("error"));
        }
        return;
      }

      this.activeVault = true;
      this.saveState.set("saving");
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.enqueueSave(snapshot, revision);
      }, 500);
    });
  }

  /** Turn the recovery copy on or off. Turning it off removes any stored copy immediately. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled()) return;
    this.writePreference(enabled);
    this.enabled.set(enabled);
    if (enabled) {
      // The effect schedules a save when a vault is open.
      if (!this.supported) this.saveState.set("error");
      else if (!this.store.vaultData()) this.saveState.set("empty");
      return;
    }
    await this.discardDraft();
    this.activeVault = false;
    if (this.saveState() !== "error") this.saveState.set("off");
  }

  private readPreference(): boolean {
    try {
      return this.storage.getItem(RECOVERY_PREF_KEY) === "1";
    } catch {
      return false;
    }
  }

  private writePreference(enabled: boolean): void {
    try {
      this.storage.setItem(RECOVERY_PREF_KEY, enabled ? "1" : "0");
    } catch {
      // Preference simply will not persist.
    }
  }

  async checkForDraft(): Promise<void> {
    if (!this.supported) {
      this.saveState.set(this.enabled() ? "error" : "off");
      this.ready.set(true);
      return;
    }

    try {
      const draft = await this.readDraft();
      if (this.store.vaultData()) {
        this.hasDraft.set(false);
        this.savedAt.set(null);
      } else {
        this.hasDraft.set(draft !== null);
        this.savedAt.set(draft?.savedAt ?? null);
        this.saveState.set(draft ? "saved" : this.enabled() ? "empty" : "off");
      }
    } catch {
      this.saveState.set(this.enabled() ? "error" : "off");
    } finally {
      this.ready.set(true);
    }
  }

  async restoreDraft(): Promise<boolean> {
    try {
      const loadRevision = this.store.loadRequestRevision;
      const draft = await this.readDraft();
      if (!draft) {
        this.hasDraft.set(false);
        this.saveState.set("empty");
        return false;
      }
      if (
        !this.enabled() ||
        !this.store.restoreRecoverySnapshotIfCurrent(draft.snapshot, loadRevision)
      ) {
        return false;
      }
      this.hasDraft.set(true);
      this.savedAt.set(draft.savedAt);
      this.saveState.set("saved");
      return true;
    } catch {
      this.saveState.set("error");
      return false;
    }
  }

  async discardDraft(): Promise<void> {
    this.revision++;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      await this.enqueueDelete(this.revision);
      this.hasDraft.set(false);
      this.savedAt.set(null);
      this.saveState.set("empty");
      this.activeVault = false;
    } catch {
      this.saveState.set("error");
    }
  }

  private isSupported(): boolean {
    return (
      typeof indexedDB !== "undefined" &&
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined"
    );
  }

  private enqueueSave(snapshot: VaultRecoverySnapshot, revision: number): void {
    this.queue = this.queue
      .then(async () => {
        if (revision !== this.revision) return;
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
        const savedAt = new Date().toISOString();
        await this.writeDraft({ key, iv: Array.from(iv), ciphertext, savedAt });
        if (revision === this.revision) {
          this.hasDraft.set(true);
          this.savedAt.set(savedAt);
          this.saveState.set("saved");
        }
      })
      .catch(() => {
        this.saveState.set("error");
      });
  }

  private enqueueDelete(revision: number): Promise<void> {
    const run = this.queue.then(async () => {
      if (revision !== this.revision) return;
      await this.deleteDraft();
      this.hasDraft.set(false);
      this.savedAt.set(null);
      this.saveState.set("empty");
    });
    // A failed delete must not poison the queue and silently stop every later save/delete.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readDraft(): Promise<{ snapshot: VaultRecoverySnapshot; savedAt: string } | null> {
    const record = await this.getRecord();
    if (!record) return null;
    const savedMs = Date.parse(record.savedAt);
    if (!Number.isFinite(savedMs) || Date.now() - savedMs > DRAFT_TTL_MS) {
      await this.deleteDraft().catch(() => undefined);
      return null;
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(record.iv) },
      record.key,
      record.ciphertext,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as VaultRecoverySnapshot;
    if (!parsed || !parsed.data || !Array.isArray(parsed.data.items)) {
      throw new Error("Invalid recovery draft");
    }
    return { snapshot: parsed, savedAt: record.savedAt };
  }

  private async getRecord(): Promise<EncryptedVaultDraft | null> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(DRAFT_KEY) as IDBRequest<
        EncryptedVaultDraft | undefined
      >;
      transaction.oncomplete = () => {
        db.close();
        resolve(request.result ?? null);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Unable to read local recovery draft"));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error("Unable to read local recovery draft"));
      };
    });
  }

  private async writeDraft(record: EncryptedVaultDraft): Promise<void> {
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record, DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft write failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft write failed"));
    }).finally(() => db.close());
  }

  private async deleteDraft(): Promise<void> {
    if (!this.isSupported()) return;
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Draft removal failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Draft removal failed"));
    }).finally(() => db.close());
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Local recovery is unavailable"));
      request.onblocked = () => reject(new Error("Local recovery database is blocked"));
    });
  }
}
