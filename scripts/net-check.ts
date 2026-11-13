/**
 * Network diagnostics. Prints the effective egress IP, whether CNKI's gate is
 * open for it, and which proxy settings Node is actually honouring.
 *
 * Usage: node dist/scripts/net-check.js
 */
import { config } from "../src/config.js";

const c = (s: string) => s;
function section(t: string): void {
  console.log(`\n== ${t} ==`);
}

section("Node / proxy settings");
console.log(`node            ${process.version}`);
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_USE_ENV_PROXY"]) {
  const v = process.env[k];
  console.log(`${k.padEnd(15)} ${v ?? "(unset)"}`);
}
const envProxyOn = process.env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy");
console.log(
  `\nNote: Node's built-in fetch ignores HTTP(S)_PROXY unless NODE_USE_ENV_PROXY=1 ` +
    `(or --use-env-proxy). Currently ${envProxyOn ? "ENABLED" : "DISABLED"} → requests go out directly.`,
);

async function ip(): Promise<string> {
  for (const url of ["https://myip.ipip.net", "https://api.ipify.org"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const t = (await res.text()).trim();
      return t.length > 120 ? t.slice(0, 120) : t;
    } catch {
      /* try the next one */
    }
  }
  return "(could not determine)";
}

section("Egress");
console.log(`ip              ${await ip()}`);
console.log("CNKI 国内版只对境内 IP 提供服务（官方 FAQ：不再支持跨境访问）。");
console.log("若上面显示境外/机房 IP，滑块会频繁出现，甚至直接拒绝。");

section("Reachability");
const started = Date.now();
try {
  const res = await fetch(`${config.base}/kns8s/search`, {
    redirect: "manual",
    headers: {
      "User-Agent": config.userAgent,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const ms = Date.now() - started;
  const loc = res.headers.get("location") ?? "";
  console.log(`status          ${res.status} (${ms} ms)`);
  if (loc.includes("/verify/home")) {
    console.log("gate            CAPTCHA required — normal for a fresh session; `cnki_warm` solves it");
  } else if (res.status === 200) {
    console.log("gate            open (a persisted cookie session may already be valid)");
  } else {
    console.log(`gate            unexpected: ${res.status} ${loc}`);
  }
} catch (err) {
  console.log(`status          FAILED: ${(err as Error).message}`);
  console.log("hint            DNS/TLS blocked? check NO_PROXY / TUN rules / firewall");
}

section("What to do");
console.log(`  • 最佳：让 kns.cnki.net 直连（境内宽带/移动网络），不要走境外代理。`);
console.log(`      Clash: DOMAIN-SUFFIX,cnki.net,DIRECT  +  DOMAIN-SUFFIX,cnki.com.cn,DIRECT`);
console.log(`  • 已在系统层用 TUN / 透明代理时，环境变量不用管，流量会自动被接管。`);
console.log(`  • 必须显式走 HTTP 代理时：NODE_USE_ENV_PROXY=1 HTTP_PROXY=… HTTPS_PROXY=… ${c("node …")}`);
console.log(`  • 出口在境外又无法调整：把服务跑在境内机器上，用 mcp-remote 桥给你本地客户端。`);
console.log(`  • 链路慢就调大 CNKI_TIMEOUT_MS（默认 ${config.timeoutMs} ms）。`);
