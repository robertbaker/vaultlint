import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Resolve the file that a write to `filePath` should actually replace. Existing symlinks (including
 * dangling ones) are followed so that an atomic rename updates the link target instead of silently
 * replacing the link itself with a regular file.
 */
export function resolveWriteTarget(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    // Not resolvable: either missing, or a dangling symlink.
  }
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      return path.resolve(path.dirname(filePath), fs.readlinkSync(filePath));
    }
  } catch {
    // Missing path: write it as given.
  }
  return filePath;
}

/** Write `content` atomically (temp file + rename), preserving symlinks and using 0600 perms. */
export function atomicWrite(filePath: string, content: string | Uint8Array): void {
  const target = resolveWriteTarget(filePath);
  try {
    if (fs.statSync(target).isDirectory()) {
      throw new Error(`Cannot write "${filePath}": it is a directory.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tempPath = path.join(path.dirname(target), `.vaultlint-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, content, { flag: "wx", mode: 0o600 });
    fs.renameSync(tempPath, target);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created or may already have been moved.
    }
    throw error;
  }
}

function canonical(filePath: string): string {
  const resolved = resolveWriteTarget(path.resolve(filePath));
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
}

/** True when two paths refer to the same file location (symlinks and case-insensitive FS aware). */
export function isSamePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Refuse report targets that would clobber something unintended: symlinks, non-regular files, or
 * any of the `protectedPaths` (input vaults, config, baselines, other outputs).
 */
export function assertSafeReportTarget(
  reportPath: string,
  label: string,
  protectedPaths: ReadonlyArray<{ path: string | undefined; label: string }> = [],
): void {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.lstatSync(reportPath);
  } catch {
    stat = undefined;
  }
  if (stat?.isSymbolicLink()) {
    throw new Error(`Refusing to write ${label} through a symbolic link: ${reportPath}`);
  }
  if (stat && !stat.isFile()) {
    throw new Error(`Refusing to write ${label}: ${reportPath} is not a regular file.`);
  }
  for (const protectedPath of protectedPaths) {
    if (protectedPath.path && isSamePath(reportPath, protectedPath.path)) {
      throw new Error(`Refusing to write ${label} over the ${protectedPath.label}: ${reportPath}`);
    }
  }
}

/** Safely write a report file (atomic, never through symlinks, never over protected inputs). */
export function writeReportFile(
  reportPath: string,
  content: string,
  label: string,
  protectedPaths: ReadonlyArray<{ path: string | undefined; label: string }> = [],
): void {
  assertSafeReportTarget(reportPath, label, protectedPaths);
  atomicWrite(reportPath, content);
}

/**
 * Read a small text/JSON config file, tolerating the byte-order marks that Windows tools add (UTF-8
 * BOM, UTF-16 LE/BE), which `JSON.parse` would otherwise reject.
 */
export function readUtf8Text(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  }
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
