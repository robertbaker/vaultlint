/** How long the object URL stays valid after the click so slow browsers can start the download. */
export const DOWNLOAD_REVOKE_DELAY_MS = 10_000;

/**
 * Trigger a browser download for a Blob. The anchor is attached to the DOM (Firefox/Safari ignore
 * clicks on detached anchors in some versions) and the object URL is revoked on a delay, because
 * revoking synchronously after `click()` can cancel the download in some browsers.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
}
