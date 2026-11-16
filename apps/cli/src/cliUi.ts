import { BRAND_NAME } from "@vaultlint/brand";
import Table from "cli-table3";
import pc from "picocolors";

export interface CliStyle {
  enabled: boolean;
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  green: (text: string) => string;
  yellow: (text: string) => string;
  blue: (text: string) => string;
  cyan: (text: string) => string;
  magenta: (text: string) => string;
  gray: (text: string) => string;
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])/g;
// eslint-disable-next-line no-control-regex
const TERMINAL_CONTROL_REGEX = /[\u0000-\u001f\u007f-\u009f]/g;

/** Strip ANSI escape sequences from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/** Determine whether ANSI color output should be enabled. */
export function isColorSupported(noColorFlag = false): boolean {
  if (noColorFlag) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

/** Create a picocolors-backed styling helper that respects color-enablement. */
export function createCliStyle(enabled: boolean): CliStyle {
  const colors = pc.createColors(enabled);
  return {
    enabled,
    bold: colors.bold,
    dim: colors.dim,
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    blue: colors.blue,
    cyan: colors.cyan,
    magenta: colors.magenta,
    gray: colors.gray,
  };
}

/** Dynamically load `@clack/prompts` (ESM) in a CommonJS-compatible way. */
export async function loadClack(): Promise<typeof import("@clack/prompts")> {
  // Using Function prevents TypeScript's CommonJS transform from rewriting import() to require().
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof import("@clack/prompts")>;
  return dynamicImport("@clack/prompts");
}

function truncateVisible(text: string, maxWidth: number): string {
  const plain = stripAnsi(text).replace(TERMINAL_CONTROL_REGEX, " ");
  if (plain.length <= maxWidth) return plain;
  if (maxWidth <= 1) return "…";
  return `${plain.slice(0, maxWidth - 1)}…`;
}

export interface TableOptions {
  maxColWidth?: number;
  alignRight?: number[];
  style?: CliStyle;
}

/** Render a clean Unicode box-drawn table using `cli-table3`. */
export function renderTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {},
): string {
  const maxColWidth = options.maxColWidth ?? 42;
  const alignRight = new Set(options.alignRight ?? []);
  const s = options.style ?? createCliStyle(false);

  const colAligns = headers.map((_, idx) => (alignRight.has(idx) ? "right" : "left")) as Array<
    "left" | "right"
  >;

  const table = new Table({
    head: headers.map((h) => s.bold(s.cyan(stripAnsi(h).replace(TERMINAL_CONTROL_REGEX, " ")))),
    colAligns,
    wordWrap: false,
    style: {
      head: [],
      border: s.enabled ? ["gray"] : [],
      compact: true,
    },
  });

  for (const row of rows) {
    table.push(row.map((cell) => truncateVisible(cell ?? "", maxColWidth)));
  }

  return table.toString();
}

/** Render a color-coded progress bar for a percentage (0-100). */
export function renderProgressBar(percent: number, style: CliStyle, width = 20): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  const colorFn = clamped >= 80 ? style.green : clamped >= 50 ? style.yellow : style.red;
  const label = clamped >= 80 ? "Good" : clamped >= 50 ? "Fair" : "Needs Attention";

  return `${colorFn(`[${bar}]`)} ${style.bold(`${clamped}%`)} ${style.dim(`(${label})`)}`;
}

/** Render a clean titled section header. */
export function renderSection(title: string, style: CliStyle): string {
  return `\n${style.bold(style.cyan(`▸ ${title}`))}`;
}

/** Render a unified brand header for CLI surfaces (interactive mode, server startup, etc.). */
export function renderBrandHeader(subtitle: string, style: CliStyle): string {
  return style.enabled
    ? `${style.bold(style.cyan(BRAND_NAME))} ${style.dim("·")} ${style.bold(subtitle)}`
    : `${BRAND_NAME} · ${subtitle}`;
}

/** Render a compact callout box. */
export function renderBox(
  title: string,
  lines: string[],
  style: CliStyle,
  tone: "info" | "warn" | "success" | "error" = "info",
): string {
  const borderColor =
    tone === "error"
      ? style.red
      : tone === "warn"
        ? style.yellow
        : tone === "success"
          ? style.green
          : style.cyan;

  const header = `${borderColor("┌─")} ${style.bold(title)}`;
  const body = lines.map((line) => `${borderColor("│")}  ${line}`);
  const footer = borderColor("└─");

  return [header, ...body, footer].join("\n");
}

export interface SpinnerHandle {
  succeed: (message?: string) => void;
  warn: (message?: string) => void;
  fail: (message?: string) => void;
  stop: () => void;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Start a lightweight terminal spinner when running in an interactive TTY. */
export function startSpinner(message: string, style: CliStyle, enabled = true): SpinnerHandle {
  if (!enabled) {
    return {
      succeed: () => {},
      warn: () => {},
      fail: () => {},
      stop: () => {},
    };
  }

  const isTty = Boolean(process.stdout.isTTY);
  if (!isTty) {
    console.log(`${style.cyan("•")} ${message}`);
    return {
      succeed: (msg) => {
        if (msg) console.log(`${style.green("✔")} ${msg}`);
      },
      warn: (msg) => {
        if (msg) console.log(`${style.yellow("⚠")} ${msg}`);
      },
      fail: (msg) => {
        if (msg) console.error(`${style.red("✖")} ${msg}`);
      },
      stop: () => {},
    };
  }

  let frameIndex = 0;
  const timer = setInterval(() => {
    const frame = style.cyan(SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]);
    frameIndex++;
    process.stdout.write(`\r\x1b[K${frame} ${message}`);
  }, 80);

  const finish = (symbol: string, finalMessage?: string) => {
    clearInterval(timer);
    process.stdout.write(`\r\x1b[K${symbol} ${finalMessage ?? message}\n`);
  };

  return {
    succeed: (msg) => finish(style.green("✔"), msg),
    warn: (msg) => finish(style.yellow("⚠"), msg),
    fail: (msg) => finish(style.red("✖"), msg),
    stop: () => {
      clearInterval(timer);
      process.stdout.write("\r\x1b[K");
    },
  };
}

export interface ProgressHandle {
  advance: (step?: number, label?: string) => void;
  succeed: (message: string) => void;
  warn: (message: string) => void;
  fail: (message: string) => void;
}

/**
 * Start a `@clack/prompts` block progress bar when running in a TTY, with a clean static fallback
 * for non-TTY environments.
 */
export async function startProgress(
  title: string,
  total: number,
  style: CliStyle,
  enabled = true,
): Promise<ProgressHandle> {
  if (!enabled || total <= 0) {
    return {
      advance: () => {},
      succeed: (msg) => {
        if (enabled && msg) console.log(`${style.green("✔")} ${msg}`);
      },
      warn: (msg) => {
        if (enabled && msg) console.log(`${style.yellow("⚠")} ${msg}`);
      },
      fail: (msg) => {
        if (enabled && msg) console.error(`${style.red("✖")} ${msg}`);
      },
    };
  }

  if (!process.stdout.isTTY) {
    console.log(`${style.cyan("•")} ${title} (${total} item(s))`);
    return {
      advance: () => {},
      succeed: (msg) => console.log(`${style.green("✔")} ${msg}`),
      warn: (msg) => console.log(`${style.yellow("⚠")} ${msg}`),
      fail: (msg) => console.error(`${style.red("✖")} ${msg}`),
    };
  }

  const clack = await loadClack();
  const bar = clack.progress({ style: "block", max: total });
  bar.start(title);

  return {
    advance: (step = 1, label?: string) => {
      bar.advance(step, label ? `${title} · ${label}` : title);
    },
    succeed: (msg) => bar.stop(style.green(msg)),
    warn: (msg) => bar.stop(style.yellow(msg)),
    fail: (msg) => bar.error(style.red(msg)),
  };
}
