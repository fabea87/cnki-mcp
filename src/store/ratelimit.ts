/** Serialise requests + enforce a minimum gap and a rolling 24h quota. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { log } from "../util/log.js";

const QUOTA_FILE = join(config.stateDir, "quota.json");

type Quota = { timestamps: number[] };

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;
let quota: Quota | null = null;

async function loadQuota(): Promise<Quota> {
  if (quota) return quota;
  try {
    quota = JSON.parse(await readFile(QUOTA_FILE, "utf8")) as Quota;
    if (!Array.isArray(quota.timestamps)) quota = { timestamps: [] };
  } catch {
    quota = { timestamps: [] };
  }
  return quota;
}

function prune(q: Quota): Quota {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  q.timestamps = q.timestamps.filter((t) => t > cutoff);
  return q;
}

async function saveQuota(q: Quota): Promise<void> {
  await mkdir(dirname(QUOTA_FILE), { recursive: true });
  await writeFile(QUOTA_FILE, JSON.stringify(q), "utf8");
}

export class QuotaExceededError extends Error {
  constructor(used: number, limit: number) {
    super(`daily quota reached (${used}/${limit}). Raise CNKI_DAILY_QUOTA if you accept the risk.`);
    this.name = "QuotaExceededError";
  }
}

/** Run `fn` after the previous one, at least `minGapMs` after the last request. */
export function enqueue<T>(fn: () => Promise<T>, label = "req"): Promise<T> {
  const run = async (): Promise<T> => {
    const q = prune(await loadQuota());
    if (q.timestamps.length >= config.dailyQuota) throw new QuotaExceededError(q.timestamps.length, config.dailyQuota);

    const wait = lastAt + config.minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    q.timestamps.push(lastAt);
    void saveQuota(q);

    log(`${label} (quota ${q.timestamps.length}/${config.dailyQuota})`);
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

export async function quotaState(): Promise<{ used: number; limit: number }> {
  const q = prune(await loadQuota());
  return { used: q.timestamps.length, limit: config.dailyQuota };
}
