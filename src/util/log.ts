/** stderr only — stdout is the MCP protocol channel. */
export function log(...parts: unknown[]): void {
  const msg = parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ");
  process.stderr.write(`[cnki-mcp] ${msg}\n`);
}

export function warn(...parts: unknown[]): void {
  log("WARN", ...parts);
}
