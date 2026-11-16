import type { AiDuplicateConfidence } from "@vaultlint/ai";
import type { DuplicateConflictSummary } from "@vaultlint/vault-ops";
import type { VaultItem } from "@vaultlint/vault-schema";

export type VaultTabId =
  | "explorer"
  | "lint"
  | "duplicates"
  | "security"
  | "batch"
  | "migration"
  | "ai"
  | "aegis"
  | "activity";
export type ExplorerFilterMode = "all" | "weak" | "reused" | "duplicate" | "fido" | "favorite";
export type ExplorerTypeFilter = "all" | "login" | "note" | "card" | "identity" | "app";
export type ThemeMode = "auto" | "light" | "dark";

export interface DuplicateGroup {
  key: string;
  /** Unique group identity (item type + name); prefer over `key` for list tracking. */
  groupKey?: string;
  name: string;
  items: Array<{ item: VaultItem; index: number }>;
  uris: string[];
  conflicts: DuplicateConflictSummary;
}

export interface AiResolvedDuplicateGroup {
  group: DuplicateGroup;
  reason: string;
  confidence: AiDuplicateConfidence;
}

export interface WeakItemInfo {
  item: VaultItem;
  index: number;
  reasons: string[];
}

export interface ReusedPasswordGroup {
  items: Array<{ item: VaultItem; index: number }>;
}

export interface BatchMatchPreview {
  label: string;
  before: string;
  after: string;
}

export interface ToastItem {
  id: number;
  message: string;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  action: string;
}

export interface InvalidUriInfo {
  item: VaultItem;
  index: number;
  invalidUris: string[];
}

export interface WebRedirectFinding {
  /** Index at detection time; kept in sync with the vault by the store (see `itemId`). */
  itemIndex: number;
  /** Stable item identity (undefined for id-less items, which are re-located by name + URI). */
  itemId?: string;
  /** In-memory snapshot used to reject findings that could otherwise alias a duplicate ID. */
  itemFingerprint?: string;
  itemName: string;
  originalUri: string;
  redirectedUri: string;
  status: number;
}

export interface WebDeadLinkFinding {
  /** Index at detection time; kept in sync with the vault by the store (see `itemId`). */
  itemIndex: number;
  /** Stable item identity (undefined for id-less items, which are re-located by name + URI). */
  itemId?: string;
  /** In-memory snapshot used to reject findings that could otherwise alias a duplicate ID. */
  itemFingerprint?: string;
  itemName: string;
  uri: string;
  reason: string;
}

export interface WebMobileUriFinding {
  /** Index at detection time; kept in sync with the vault by the store (see `itemId`). */
  itemIndex: number;
  /** Stable item identity (undefined for id-less items, which are re-located by name + URI). */
  itemId?: string;
  /** In-memory snapshot used to reject findings that could otherwise alias a duplicate ID. */
  itemFingerprint?: string;
  itemName: string;
  uri: string;
  /** Original web URI that caused a suggested app URI, used to discard stale suggestions. */
  sourceUri?: string;
  status: "valid" | "invalid" | "suggested" | "unverified";
  detail: string;
}

export interface VaultChartBreakdown {
  totalItems: number;
  strongCount: number;
  weakCount: number;
  reusedCount: number;
  noPasswordCount: number;
  loginCount: number;
  noteCount: number;
  cardCount: number;
  identityCount: number;
  appCount: number;
}

export interface ExplorerRow {
  item: VaultItem;
  index: number;
  key: string;
  name: string;
  folderName: string;
  username: string;
  password: string;
  uris: string[];
  itemType: number;
  isMobileApp: boolean;
  isWeak: boolean;
  isReused: boolean;
  isDup: boolean;
  isBreached: boolean;
  hasFido: boolean;
  isFavorite: boolean;
}

export type VendorCliId =
  | "bitwarden"
  | "lastpass"
  | "dashlane"
  | "keeper"
  | "proton-pass"
  | "nordpass"
  | "1password";

export interface VendorCliProviderInfo {
  id: VendorCliId;
  displayName: string;
  binary: string;
  read: boolean;
  write: boolean;
  unsupportedReason?: { read?: string; write?: string };
}

export interface VendorPlanSummary {
  creates: number;
  updates: number;
  removes: number;
  newFolders: number;
  updatedFolders: number;
  removedFolders: number;
  lines: string[];
}

export interface VendorPushResult {
  created: number;
  updated: number;
  removed: number;
  newFolders: number;
  updatedFolders: number;
  removedFolders: number;
}
