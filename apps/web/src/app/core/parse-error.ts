/**
 * Message for an error raised while parsing a user-supplied file. V8's JSON syntax errors quote a
 * snippet of the input, which for a vault export can contain credentials; toasts and the activity
 * log would keep it, so the quoted text is never surfaced.
 */
export function parseErrorMessage(err: unknown): string {
  if (err instanceof SyntaxError) return err.message.replace(/"[\s\S]*"/, '"…"');
  if (err instanceof Error && err.message) return err.message;
  return typeof err === "string" && err ? err : "Unexpected error.";
}
