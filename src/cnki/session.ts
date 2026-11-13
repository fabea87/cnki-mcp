/** Session lifecycle: load → use → re-warm on the captcha gate. */
import { config } from "../config.js";
import { log, warn } from "../util/log.js";
import { loadSession, saveSession, SessionExpiredError, type Session } from "./http.js";
import { warmSession } from "./warm.js";

let current: Session | null = null;
let warming: Promise<Session> | null = null;

export async function getSession(forceWarm = false): Promise<Session> {
  if (!forceWarm && current) return current;
  if (!forceWarm) {
    const loaded = await loadSession();
    if (loaded) {
      current = loaded;
      return loaded;
    }
  }
  if (warming) return warming;
  warming = (async () => {
    log("warming session (captcha gate)…");
    const r = await warmSession(5);
    if (!r.ok) throw new Error(`could not clear the CNKI captcha gate (${r.message ?? "unknown"})`);
    const s = await loadSession();
    if (!s) throw new Error("warm-up finished without a saved session");
    current = s;
    log(`session ready (${s.cookies.length} cookies, attempts=${r.attempts})`);
    // Reset the "seen" marker so the next call probes lazily.
    warming = null;
    return s;
  })().catch((e) => {
    warming = null;
    throw e;
  });
  return warming;
}

/** Run an operation with the stored session; re-warm once if the gate closes. */
export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  let session = await getSession();
  try {
    const out = await fn(session);
    session.lastOkAt = Date.now();
    return out;
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) throw err;
    warn("session expired →", err.verifyUrl ? "gate returned a verify URL" : err.message);
    if (!config.autoWarm) throw err;
    session = await getSession(true);
    const out = await fn(session);
    session.lastOkAt = Date.now();
    await saveSession(session).catch(() => undefined);
    return out;
  }
}

export function sessionInfo(): { cookies: number; warmedAt: number | null; lastOkAt: number | null } {
  return {
    cookies: current?.cookies.length ?? 0,
    warmedAt: current?.warmedAt ?? null,
    lastOkAt: current?.lastOkAt ?? null,
  };
}
