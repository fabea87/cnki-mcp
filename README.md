# cnki-mcp

Self-maintained CNKI MCP server in TypeScript. Pure HTTP with an in-process slider-captcha solver — no browser, no Python, no pinned SDK.

## Requirements

- Node >= 20 (`NODE_USE_ENV_PROXY` needs Node >= 24)
- Egress from mainland China — the domestic CNKI site refuses cross-border access (see [Network](#network))

## Quick start

```bash
git clone https://github.com/fabea87/cnki-mcp.git
cd cnki-mcp
npm install
npm run build

node dist/scripts/net-check.js                 # egress + captcha-gate check
node dist/scripts/smoke.js "corpus linguistics" # end-to-end check
```

Optional global install: `npm install -g .` provides a `cnki-mcp` binary.

Session, cache, and quota state live in `~/.pi/agent/state/cnki-mcp`; override with `CNKI_STATE_DIR`.

## MCP client setup

This is a stdio server. Any stdio MCP client accepts:

```jsonc
{ "command": "node", "args": ["/abs/path/to/cnki-mcp/dist/src/index.js"] }
// or after a global install:
{ "command": "cnki-mcp" }
```

Claude Desktop, Cursor, VS Code, and Codex use the same `command`/`args` under their own `mcpServers` / `servers` keys. Claude Code:

```bash
claude mcp add cnki -- node /abs/path/to/cnki-mcp/dist/src/index.js
```

For pi, put the same object under `mcpServers.cnki` in `~/.pi/agent/mcp.json`, then `/reload` or `/mcp reconnect cnki`.

HTTP/SSE-only clients need a bridge:

```bash
npx -y mcp-remote@latest --transport stdio -- node /abs/path/to/cnki-mcp/dist/src/index.js
```

## Tools

| Tool | Purpose |
| --- | --- |
| `cnki_search` | Search by keyword, with search type, paging, sort, resource and year filters. |
| `cnki_get_paper_detail` | Full metadata plus GB/T 7714 / APA / BibTeX / RIS citations. |
| `cnki_cite` | Batch citations (up to 20). |
| `cnki_warm` | Re-solve the captcha and rebuild the session. |
| `cnki_status` | Session, quota, and cache status. |

In list results, `cited=null` means zero citations (CNKI omits empty cells).

## Network

Domestic CNKI (`www.cnki.net`, `kns.cnki.net`) serves mainland IPs only; overseas access requires a different, unsupported platform. A fresh session is always redirected to a slider captcha — session admission, not rate limiting. Keep CNKI on a mainland route:

```yaml
rules:
  - DOMAIN-SUFFIX,cnki.net,DIRECT
  - DOMAIN-SUFFIX,cnki.com.cn,DIRECT
  - DOMAIN-SUFFIX,kns.cnki.net,DIRECT
```

Node's `fetch` ignores proxy environment variables unless enabled: set `NODE_USE_ENV_PROXY=1` alongside `HTTP_PROXY` / `HTTPS_PROXY`, and keep CNKI hosts in `NO_PROXY`. With a system-level TUN / transparent proxy, no variables are needed (`net-check` reports `DISABLED -> requests go out directly`). If mainland egress is unavailable, run the server on a mainland machine and bridge it with `mcp-remote` / `supergateway`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CNKI_STATE_DIR` | `~/.pi/agent/state/cnki-mcp` | Session, cache, quota files |
| `CNKI_MIN_GAP_MS` | `2000` | Minimum gap between requests |
| `CNKI_DAILY_QUOTA` | `300` | Rolling 24-hour request cap |
| `CNKI_CACHE_TTL_MS` | `86400000` | Query cache TTL |
| `CNKI_TIMEOUT_MS` | `30000` | Per-request timeout |
| `CNKI_AUTO_WARM` | `1` | Re-solve captcha on session expiry |
| `CNKI_UA` | Built-in Chrome UA | Custom User-Agent |

## Layout

```
src/index.ts     MCP tool registration (stdio)
src/cnki/        HTTP, session, captcha, search, detail, citations
src/store/       JSON cache, serial rate limiter
scripts/         smoke, net-check, paging-test, captcha probe
```

## Limitations

- Online-first papers have no volume/issue/pages; pass `hint_journal` / `hint_date` from the search row.
- Paging requires page 1 first (server-side `turnpage` token); the client caches it.
- Only relevance and date sorting are exposed; citation/download sorting is unverified.
- Reference and citation lists use a separate AJAX endpoint (not implemented).
- CNKI prohibits automated scraping; raising quotas is at your own risk.
- stdio only; no HTTP endpoint.
