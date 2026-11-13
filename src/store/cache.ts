/** Tiny JSON-file cache with TTL. Survives across pi sessions. */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "../config.js";
import { log } from "../util/log.js";

type Entry = { at: number; value: string };
type Store = Record<string, Entry>;

let memory: Store | null = null;
let dirty = false;
let flushing: Promise<void> | null = null;

async function load(): Promise<Store> {
  if (memory) return memory;
  try {
    memory = JSON.parse(await readFile(config.cacheFile, "utf8")) as Store;
  } catch {
    memory = {};
  }
  return memory;
}

async function flush(): Promise<void> {
  if (!memory || !dirty) return;
  if (flushing) return flushing;
  dirty = false;
  const tmp = `${config.cacheFile}.tmp`;
  flushing = (async () => {
    await mkdir(dirname(config.cacheFile), { recursive: true });
    await writeFile(tmp, JSON.stringify(memory), "utf8");
    await rename(tmp, config.cacheFile);
    flushing = null;
  })();
  return flushing;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const store = await load();
  const hit = store[key];
  if (!hit) return null;
  if (Date.now() - hit.at > config.cacheTtlMs) {
    delete store[key];
    dirty = true;
    return null;
  }
  try {
    return JSON.parse(hit.value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const store = await load();
  store[key] = { at: Date.now(), value: JSON.stringify(value) };
  dirty = true;
  // Cap the store so it never grows unbounded.
  const keys = Object.keys(store);
  if (keys.length > 500) {
    keys
      .sort((a, b) => store[a]!.at - store[b]!.at)
      .slice(0, keys.length - 500)
      .forEach((k) => delete store[k]);
  }
  setTimeout(() => void flush().catch((e) => log("cache flush failed", String(e))), 50);
}

export async function cacheStats(): Promise<{ entries: number; bytes: number }> {
  const store = await load();
  return { entries: Object.keys(store).length, bytes: JSON.stringify(store).length };
}
