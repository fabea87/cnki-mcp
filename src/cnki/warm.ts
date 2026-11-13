/**
 * Session warm-up: clear the blockPuzzle gate without a browser.
 *
 * Protocol (reverse-engineered from /verify/js/*.js, anji-plus style):
 *   GET  /kns8s/search                → 302 /verify/home?ident&captchaId&returnUrl
 *   POST /verify-api/get              → {secretKey, originalImageBase64, jigsawImageBase64, token}
 *   POST /verify-api/web/check        → {captchaType, pointJson, token, ident, returnUrl}
 *     pointJson = AES-128-ECB/Pkcs7(JSON({x,y:5}), secretKey) as hex
 *   GET  returnUrl + "?captchaId=…"   → sets the session cookies
 */
import { createCipheriv } from "node:crypto";
import { config } from "../config.js";
import { log, warn } from "../util/log.js";
import { CookieJar } from "./jar.js";
import { solveOffset } from "./puzzle.js";
import { saveSession, sessionAlive, type Cookie, type Session } from "./http.js";

const REF_W = 310; // the client normalises drag distance against a 310px-wide image
const BASE_HEADERS = {
  "User-Agent": config.userAgent,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  "Content-Type": "application/json;charset=UTF-8",
  Origin: config.base,
};

function aesHex(plain: string, key: string): string {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
  // CryptoJS `toString()` emits the OpenSSL format, i.e. base64 — not hex.
  return Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]).toString("base64");
}

async function postJson(jar: CookieJar, path: string, body: unknown, referer: string): Promise<any> {
  const res = await fetch(`${config.base}${path}`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Cookie: jar.header(), Referer: referer },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  jar.absorb(res);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getPage(jar: CookieJar, url: string, referer?: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": config.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      ...(referer ? { Referer: referer } : {}),
      ...(jar.size ? { Cookie: jar.header() } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  jar.absorb(res);
  return res;
}

export type WarmResult = { ok: boolean; attempts: number; cookies: number; message?: string };

/** Solve one captcha round and return the URL that must be visited to mint cookies. */
async function solveOne(jar: CookieJar, verifyUrl: string): Promise<{ ok: boolean; url?: string }> {
  const u = new URL(verifyUrl);
  const ident = u.searchParams.get("ident") ?? "";
  const captchaId = u.searchParams.get("captchaId") ?? "";
  const returnUrl = u.searchParams.get("returnUrl") ?? "";

  // Load the page once so the fingerprint/session cookie exists.
  await getPage(jar, verifyUrl, `${config.base}/kns8s/search`);

  const got = await postJson(jar, "/verify-api/get", {
    captchaType: "blockPuzzle",
    clientUid: null,
    ident,
    captchaId,
    ts: Date.now(),
  }, verifyUrl);

  const d = got?.data;
  if (!d?.originalImageBase64 || !d?.jigsawImageBase64) {
    throw new Error(`/verify-api/get failed: ${JSON.stringify(got).slice(0, 300)}`);
  }

  const off = solveOffset(d.originalImageBase64, d.jigsawImageBase64);
  const x = Math.round((REF_W * off.x) / off.width);
  log(`captcha solved: px=${off.x} scaled=${x} ncc=${off.score.toFixed(3)} bg=${off.width}x${off.height}`);

  const point = JSON.stringify({ x, y: 5 });
  const checked = await postJson(jar, "/verify-api/web/check", {
    captchaType: "blockPuzzle",
    pointJson: aesHex(point, d.secretKey),
    token: d.token,
    ident,
    returnUrl,
  }, verifyUrl);

  if (String(checked?.code) !== "0") {
    warn("captcha check rejected:", JSON.stringify(checked).slice(0, 200));
    return { ok: false };
  }

  const back = checked?.data?.returnUrl ?? returnUrl;
  const sep = back.includes("?") ? "&" : "?";
  return { ok: true, url: `${back}${sep}captchaId=${captchaId}` };
}

/**
 * Warm a session: clear the gate, persist cookies.
 * Retries a few times because a single puzzle can be mis-solved.
 */
export async function warmSession(maxAttempts = 5): Promise<WarmResult> {
  const jar = new CookieJar();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await getPage(jar, `${config.base}/kns8s/search`);
    let verifyUrl = res.headers.get("location");

    if (!verifyUrl) {
      // Already through (rare on a cold jar).
      log("gate not triggered; session appears warm");
      return persist(jar, attempt);
    }
    if (!verifyUrl.startsWith("http")) verifyUrl = new URL(verifyUrl, config.base).toString();

    const solved = await solveOne(jar, verifyUrl);
    if (!solved.ok || !solved.url) continue;

    // Follow the minted URL: this is what actually sets the session cookies.
    const done = await getPage(jar, solved.url, verifyUrl);
    log(`post-verify: ${done.status} -> ${done.headers.get("location") ?? "(no redirect)"}`);
    const loc = done.headers.get("location");
    if (loc) await getPage(jar, new URL(loc, config.base).toString(), solved.url);

    const candidate: Session = {
      cookies: jar.toJSON().map((c) => ({ name: c.name, value: c.value })),
      warmedAt: Date.now(),
    };
    if (await sessionAlive(candidate)) return persist(jar, attempt);
    warn("warm-up looked successful but brief/grid is still gated; retrying");
  }
  return { ok: false, attempts: maxAttempts, cookies: jar.size, message: "captcha not cleared" };
}

async function persist(jar: CookieJar, attempts: number): Promise<WarmResult> {
  const cookies: Cookie[] = jar.toJSON().map((c) => ({ name: c.name, value: c.value }));
  const session: Session = { cookies, warmedAt: Date.now(), note: `warm attempts=${attempts}` };
  await saveSession(session);
  log(`session saved: ${cookies.length} cookies → ${config.sessionFile}`);
  return { ok: true, attempts, cookies: cookies.length };
}
