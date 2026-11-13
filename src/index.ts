/**
 * cnki-mcp — self-maintained CNKI (知网) MCP server.
 *
 * Fast path is plain HTTP against kns.cnki.net with a persisted cookie session;
 * the slider captcha is solved in-process (no browser, no Python). See README.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config } from "./config.js";
import { log } from "./util/log.js";
import { withSession, getSession, sessionInfo } from "./cnki/session.js";
import { SEARCH_TYPES, search, type ResourceKind, type SearchType } from "./cnki/search.js";
import { getDetail } from "./cnki/detail.js";
import { formatCite, type CiteStyle } from "./cnki/cite.js";
import { cacheGet, cacheSet, cacheStats } from "./store/cache.js";
import { enqueue, quotaState, QuotaExceededError } from "./store/ratelimit.js";

const server = new McpServer({ name: "cnki", version: "0.1.0" });

function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function fail(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const msg = err instanceof Error ? err.message : String(err);
  log("tool error:", msg);
  return { content: [{ type: "text", text: `ERROR: ${msg}` }], isError: true };
}

const RESOURCES = ["总库", "期刊", "博士", "硕士", "会议", "报纸", "图书", "专利", "标准", "成果"] as const;

server.registerTool(
  "cnki_search",
  {
    title: "知网检索",
    description:
      "检索中国知网（CNKI）。返回题名、作者、来源刊、发表时间、被引、下载量与详情页 URL。慢速串行、带 24h 缓存与每日配额。",
    inputSchema: {
      keyword: z.string().min(1).describe("检索词"),
      search_type: z
        .enum(["SU", "TI", "AU", "KY", "AB", "FT"])
        .default("SU")
        .describe("检索项：SU 主题 / TI 篇名 / AU 作者 / KY 关键词 / AB 摘要 / FT 全文"),
      page_size: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20).describe("每页条数"),
      page_num: z.number().int().min(1).default(1).describe("页码（先用第 1 页，再翻页）"),
      sort: z.enum(["relevance", "time"]).default("relevance").describe("排序：相关度 / 发表时间倒序"),
      resource: z.array(z.enum(RESOURCES)).optional().describe("按数据库类型过滤（本地过滤，如 ['期刊']）"),
      year_from: z.number().int().min(1900).optional().describe("起始年份（本地过滤）"),
      year_to: z.number().int().max(2100).optional().describe("截止年份（本地过滤）"),
      use_cache: z.boolean().default(true).describe("是否使用 24h 查询缓存"),
    },
  },
  async (args) => {
    try {
      const params = {
        keyword: args.keyword.trim(),
        searchType: args.search_type as SearchType,
        pageSize: args.page_size,
        pageNum: args.page_num,
        sort: args.sort,
        resource: args.resource as ResourceKind[] | undefined,
        yearFrom: args.year_from,
        yearTo: args.year_to,
      };
      const key = `search:${JSON.stringify(params)}`;
      if (args.use_cache) {
        const hit = await cacheGet<unknown>(key);
        if (hit) return text({ cached: true, ...(hit as object) });
      }
      const res = await enqueue(
        () => withSession((s) => search(s, params)),
        `search ${params.keyword}`,
      );
      await cacheSet(key, res);
      return text(res);
    } catch (err) {
      if (err instanceof QuotaExceededError) return fail(err);
      return fail(err);
    }
  },
);

server.registerTool(
  "cnki_get_paper_detail",
  {
    title: "知网文献详情",
    description:
      "根据详情页 URL 抓取完整元数据：题名、作者、机构、刊名/年/卷/期/页、DOI、摘要、关键词、基金、分类号，并本地生成 GB/T 7714、APA、BibTeX、RIS 引文。",
    inputSchema: {
      url: z.string().url().describe("详情页 URL（cnki_search 结果里的 url 字段）"),
      hint_journal: z.string().optional().describe("可选：搜索结果里的 journal，用于补全网络首发文献的刊名"),
      hint_date: z.string().optional().describe("可选：搜索结果里的 date（如 2026-10-01），用于补全年份"),
      use_cache: z.boolean().default(true).describe("是否使用 24h 缓存"),
    },
  },
  async (args) => {
    try {
      const key = `detail:${args.url}:${args.hint_journal ?? ""}:${args.hint_date ?? ""}`;
      if (args.use_cache) {
        const hit = await cacheGet<unknown>(key);
        if (hit) return text({ cached: true, ...(hit as object) });
      }
      const detail = await enqueue(
        () => withSession((s) => getDetail(s, args.url, { journal: args.hint_journal, date: args.hint_date })),
        "detail",
      );
      const out = {
        ...detail,
        cite: {
          gb7714: formatCite(detail, "gb7714"),
          apa: formatCite(detail, "apa"),
          bibtex: formatCite(detail, "bibtex"),
        },
      };
      await cacheSet(key, out);
      return text(out);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "cnki_cite",
  {
    title: "批量引文",
    description: "批量抓取多条文献并只返回引文文本（GB/T 7714 / APA / BibTeX / RIS）。可直接粘进 Zotero 或稿件。",
    inputSchema: {
      urls: z.array(z.string().url()).min(1).max(20).describe("详情页 URL 列表"),
      style: z.enum(["gb7714", "apa", "bibtex", "ris"]).default("gb7714").describe("引文格式"),
    },
  },
  async (args) => {
    const style = args.style as CiteStyle;
    const lines: string[] = [];
    const errors: string[] = [];
    for (const url of args.urls) {
      try {
        const key = `detail:${url}`;
        const cached = await cacheGet<{ gb7714?: string } & Record<string, unknown>>(key);
        if (cached) {
          const c = (cached.cite as Record<string, string> | undefined)?.[style];
          if (c) {
            lines.push(c);
            continue;
          }
        }
        const detail = await enqueue(() => withSession((s) => getDetail(s, url)), "cite");
        lines.push(formatCite(detail, style));
        await cacheSet(key, { ...detail, cite: { gb7714: formatCite(detail, "gb7714") } });
      } catch (err) {
        errors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return text({
      style,
      count: lines.length,
      citations: lines,
      ...(errors.length ? { errors } : {}),
    });
  },
);

server.registerTool(
  "cnki_warm",
  {
    title: "重建知网会话",
    description: "重新通过安全验证（自动解拼图滑块）并保存 cookie 会话。会话失效或换网络后调用。",
    inputSchema: {},
  },
  async () => {
    try {
      const s = await getSession(true);
      return text({
        ok: true,
        cookies: s.cookies.map((c) => c.name),
        warmedAt: new Date(s.warmedAt).toISOString(),
      });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "cnki_status",
  {
    title: "会话与配额状态",
    description: "显示 cookie 会话状态、今日请求配额、缓存条数与当前配置。",
    inputSchema: {},
  },
  async () => {
    try {
      const quota = await quotaState();
      const cache = await cacheStats();
      const info = sessionInfo();
      return text({
        session: {
          ...info,
          warmedAtIso: info.warmedAt ? new Date(info.warmedAt).toISOString() : null,
          lastOkAtIso: info.lastOkAt ? new Date(info.lastOkAt).toISOString() : null,
        },
        quota,
        cache,
        config: {
          minGapMs: config.minGapMs,
          dailyQuota: config.dailyQuota,
          cacheTtlHours: config.cacheTtlMs / 3600000,
          autoWarm: config.autoWarm,
          stateDir: config.stateDir,
        },
        searchTypes: SEARCH_TYPES,
      });
    } catch (err) {
      return fail(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready (state: ${config.stateDir})`);
