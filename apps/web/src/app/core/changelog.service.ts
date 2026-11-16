import { inject, Injectable, signal } from "@angular/core";

import { CHANGELOG_READ_KEY, CHANGELOG_SEEN_KEY, hasUnreadChangelog } from "./changelog";
import { BROWSER_STORAGE } from "./storage.token";

/**
 * Tracks whether the user has unread release notes for the running app version via injected
 * `BROWSER_STORAGE`.
 */
@Injectable({ providedIn: "root" })
export class ChangelogService {
  private readonly storage = inject(BROWSER_STORAGE);

  private readonly _hasNewChangelog = signal(false);
  readonly hasNewChangelog = this._hasNewChangelog.asReadonly();

  /**
   * Record the current version as seen, determine if it is unread, and return a user-facing update
   * message when upgrading from a previously seen version.
   */
  checkForUpdate(currentVersion: string): string | null {
    const seen = this.storage.getItem(CHANGELOG_SEEN_KEY);
    let updateNotice: string | null = null;

    if (seen !== currentVersion) {
      this.storage.setItem(CHANGELOG_SEEN_KEY, currentVersion);
      if (seen && this.storage.getItem(CHANGELOG_READ_KEY) === null) {
        this.storage.setItem(CHANGELOG_READ_KEY, seen);
      }
      if (seen) {
        updateNotice = `vaultlint updated to v${currentVersion}. Open the changelog in the header to see what's new.`;
      }
    }

    this._hasNewChangelog.set(
      hasUnreadChangelog(this.storage.getItem(CHANGELOG_READ_KEY), currentVersion),
    );
    return updateNotice;
  }

  markAsRead(): void {
    this._hasNewChangelog.set(false);
  }
}
