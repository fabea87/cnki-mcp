/** Paths and tunables. Resolution is absolute: pi spawns this with the session cwd. */
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const STATE_DIR = process.env.CNKI_STATE_DIR ?? join(home, ".pi", "agent", "state", "cnki-mcp");
export const SESSION_FILE = join(STATE_DIR, "session.json");
export const CACHE_FILE = join(STATE_DIR, "cache.json");

export const config = {
  /** Base origin for the KNS platform. */
  base: "https://kns.cnki.net",
  stateDir: STATE_DIR,
  sessionFile: SESSION_FILE,
  cacheFile: CACHE_FILE,

  userAgent:
    process.env.CNKI_UA ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",

  /** Politeness: minimum gap between two CNKI requests (ms). */
  minGapMs: Number(process.env.CNKI_MIN_GAP_MS ?? 2000),
  /** Hard cap on requests per rolling 24h. Keeps the IP out of trouble. */
  dailyQuota: Number(process.env.CNKI_DAILY_QUOTA ?? 300),
  /** Search-result cache TTL (ms). */
  cacheTtlMs: Number(process.env.CNKI_CACHE_TTL_MS ?? 24 * 3600 * 1000),
  /** Per-request timeout (ms). */
  timeoutMs: Number(process.env.CNKI_TIMEOUT_MS ?? 30000),
  /** Re-warm the session automatically when it expires. */
  autoWarm: process.env.CNKI_AUTO_WARM !== "0",
  /** Headful browser during warm-up (easier to debug, required if auto-solve fails). */
  warmHeadful: process.env.CNKI_WARM_HEADLESS === "0",
};

export const UA_CHROME_MAJOR = config.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "131";
