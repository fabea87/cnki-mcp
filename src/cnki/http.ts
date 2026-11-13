/** Persistent cookie jar + HTTP client with session-expiry detection. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config, UA_CHROME_MAJOR } from "../config.js";
import { log } from "../util/log.js";

export type Cookie = { name: string; value: string; domain?: string; path?: string; expires?: number };

export type Session = {
  cookies: Cookie[];
  /** Epoch ms when the warm-up finished. */
  warmedAt: number;
  /** Epoch ms of the last successful authenticated request. */
  lastOkAt?: number;
  /** Fingerprint that produced these cookies, for diagnostics. */
  note?: string;
};

export class SessionExpiredError extends Error {
  constructor(public readonly verifyUrl: string | null, message = "CNKI session expired (captcha gate)") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await readFile(config.sessionFile, "utf8");
    const s = JSON.parse(raw) as Session;
    return Array.isArray(s.cookies) ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  await mkdir(dirname(config.sessionFile), { recursive: true });
  await writeFile(config.sessionFile, JSON.stringify(s, null, 2), "utf8");
}

export function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Clash-style TUN may hand us a fake IP; DNS is not our problem. */
export function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": config.userAgent,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Accept: "*/*",
    "sec-ch-ua": `"Chromium";v="${UA_CHROME_MAJOR}", "Google Chrome";v="${UA_CHROME_MAJOR}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    ...extra,
  };
}

const VERIFY_RE = /\/verify\/home\?([^\s"']+)/;

function verifyUrlOf(status: number, location: string | null, body: string): string | null {
  if (location && location.includes("/verify/home")) return location;
  if (status === 403) {
    const m = body.match(VERIFY_RE);
    if (m?.[1]) return `${config.base}/verify/home?${m[1]}`;
  }
  return null;
}

export type FetchOpts = {
  method?: "GET" | "POST";
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** Do not throw on the captcha gate; return the verify URL instead. */
  tolerateGate?: boolean;
};

export type FetchResult = {
  status: number;
  body: string;
  url: string;
  gate: string | null;
};

/** One authenticated request against kns.cnki.net using the stored cookies. */
export async function cnkiFetch(path: string, session: Session, opts: FetchOpts = {}): Promise<FetchResult> {
  const url = path.startsWith("http") ? path : `${config.base}${path}`;
  const headers = baseHeaders({
    Cookie: cookieHeader(session.cookies),
    Referer: `${config.base}/kns8s/defaultresult/index`,
    ...(opts.method === "POST"
      ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }
      : {}),
    ...opts.headers,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
      redirect: "manual",
      signal: ac.signal,
    });
    const body = await res.text();
    const location = res.headers.get("location");
    const gate = verifyUrlOf(res.status, location, body);
    if (gate && !opts.tolerateGate) throw new SessionExpiredError(gate);
    return { status: res.status, body, url: location ?? url, gate };
  } finally {
    clearTimeout(timer);
  }
}

/** Cheap probe: does this cookie set still clear the gate? */
export async function sessionAlive(session: Session): Promise<boolean> {
  try {
    const r = await cnkiFetch("/kns8s/brief/grid", session, {
      method: "POST",
      form: {
        boolSearch: "true",
        QueryJson: JSON.stringify({
          Platform: "",
          Resource: "CROSSDB",
          Classid: "WD0FTY92",
          Products: "",
          QNode: {
            QGroup: [
              {
                Key: "Subject",
                Title: "",
                Logic: 0,
                Items: [{ Field: "SU", Value: "语料库", Operator: "TOPRANK", Logic: 0 }],
                ChildItems: [],
              },
            ],
          },
          ExScope: 1,
          SearchType: 1,
          Rlang: "CHINESE",
          KuaKuCode: "",
          Expands: {},
          View: "changeDBCh",
          SearchFrom: 1,
        }),
        pageNum: "1",
        pageSize: "10",
        dstyle: "listmode",
        boolSortSearch: "false",
        aside: "",
        searchFrom: "资源范围：总库",
        language: "CHS",
        uniplatform: "NZKPT",
        CurPage: "1",
      },
      tolerateGate: true,
    });
    log("sessionAlive probe", r.status, r.gate ? "GATED" : "OK");
    return !r.gate && r.status === 200;
  } catch (err) {
    log("sessionAlive error", (err as Error).message);
    return false;
  }
}
