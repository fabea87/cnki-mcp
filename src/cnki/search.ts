/**
 * Result-list search over POST /kns8s/brief/grid.
 *
 * The endpoint returns an HTML fragment (not JSON): a table of rows plus hidden
 * inputs carrying the total count and the paging token.
 */
import { parseHTML } from "linkedom";
import { cnkiFetch, type Session } from "./http.js";
import { log } from "../util/log.js";

export const SEARCH_TYPES = {
  SU: "主题",
  TI: "篇名",
  AU: "作者",
  KY: "关键词",
  AB: "摘要",
  FT: "全文",
} as const;
export type SearchType = keyof typeof SEARCH_TYPES;

/** DB codes accepted by the KNS8 platform. */
const KUA_KU_CODES =
  "YSTT4HG0,LSTPFY1C,EMRPGLPA,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,NN3FJMUV,NLBO1Z6R";

export type ResourceKind = "总库" | "期刊" | "学位论文" | "会议" | "报纸" | "图书" | "专利" | "标准" | "成果";

export type SearchParams = {
  keyword: string;
  searchType?: SearchType;
  pageSize?: 10 | 20 | 50;
  pageNum?: number;
  sort?: "relevance" | "time";
  /** Client-side filter on the 数据库 column. */
  resource?: ResourceKind[];
  /** Client-side filter on the 发表时间 column, e.g. "2020-2026". */
  yearFrom?: number;
  yearTo?: number;
};

export type PaperRow = {
  seq: number;
  title: string;
  authors: string[];
  journal: string;
  date: string;
  year: number | null;
  dbType: string;
  cited: number | null;
  downloads: number | null;
  url: string;
  /** Opaque per-row handle CNKI uses for exports. */
  handle: string;
};

export type SearchResult = {
  total: number;
  pageNum: number;
  totalPages: number;
  pageSize: number;
  turnPageToken: string | null;
  items: PaperRow[];
  /** Items before client-side filtering. */
  rawCount: number;
};

/**
 * Paging (captured from the real UI): page 2+ is NOT the page-1 payload with a
 * bigger pageNum. It differs in every one of these fields:
 *   boolSearch=false, QueryJson.Products=<db code list> (Resource stays CROSSDB,
 *   Classid stays), SearchFrom=4, aside="", plus turnpage=<token from page 1>,
 *   and no CurPage.
 */
const PAGE2_DB_CODES =
  "CJFQ,CAPJ,ZHYX,CJTL,CDFD,CMFD,WBFD,CPFD,IPFD,CCND,SCSF,SCHF,SCSD,SNAD,CCJD,CJFN,CCVD";

type PagingState = { token: string; queryJson: unknown; dbCodes: string };
/** Paging state is per-result-set; page 1 seeds it, page 2+ consumes it. */
const pagingCache = new Map<string, PagingState>();

function queryKey(p: SearchParams): string {
  return `${p.searchType ?? "SU"}:${p.keyword}:${p.pageSize ?? 20}`;
}

function buildQueryJson(p: SearchParams): Record<string, unknown> {
  const field = p.searchType ?? "SU";
  return {
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
          Items: [
            {
              Field: field,
              Value: p.keyword,
              Operator: "TOPRANK",
              Logic: 0,
              Vector: "",
              Title: SEARCH_TYPES[field],
            },
          ],
          ChildItems: [],
        },
      ],
    },
    ExScope: 1,
    SimpTrad: "0",
    SearchType: 2,
    Rlang: "CHINESE",
    KuaKuCode: KUA_KU_CODES,
    Expands: {},
    View: "changeDBCh",
    SearchFrom: 1,
  };
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToPaper(tr: Element, seq: number): PaperRow | null {
  const titleA = tr.querySelector('td.name a.fz14, td.name a');
  if (!titleA) return null;
  const href = titleA.getAttribute("href") ?? "";
  const date = tr.querySelector("td.date")?.textContent?.trim() ?? "";
  const year = /(\d{4})/.exec(date)?.[1];
  return {
    seq,
    title: textOf(titleA.innerHTML),
    authors: [...tr.querySelectorAll("td.author a")]
      .map((a) => (a.textContent ?? "").trim())
      .filter(Boolean),
    journal: textOf(tr.querySelector("td.source")?.innerHTML ?? ""),
    date,
    year: year ? Number(year) : null,
    dbType: (tr.querySelector("td.data")?.textContent ?? "").trim(),
    cited: num(tr.querySelector("td.quote")?.textContent ?? undefined),
    downloads: num(tr.querySelector("td.download a")?.textContent ?? undefined),
    url: href.startsWith("http") ? href : `https://kns.cnki.net${href}`,
    handle:
      tr.querySelector('input[name="CookieName"]')?.getAttribute("value") ??
      "",
  };
}

export function parseSearchHtml(html: string): SearchResult {
  const { document } = parseHTML(html);

  const total = num(document.querySelector("#totalCnt")?.getAttribute("value") ?? undefined) ?? 0;
  const mark = document.querySelector(".countPageMark")?.textContent?.trim() ?? "";
  const mm = /(\d+)\s*\/\s*(\d+)/.exec(mark);
  const pageNum = mm ? Number(mm[1]) : 1;
  const totalPages = mm ? Number(mm[2]) : 1;
  const turnPageToken = document.querySelector("#hidTurnPage")?.getAttribute("value") ?? null;

  const rows = [...document.querySelectorAll("table.result-table-list tbody tr")];
  const items: PaperRow[] = [];
  let seq = 0;
  for (const tr of rows) {
    seq += 1;
    const p = rowToPaper(tr as Element, seq);
    if (p) items.push(p);
  }
  return {
    total,
    pageNum,
    totalPages,
    pageSize: items.length,
    turnPageToken,
    items,
    rawCount: items.length,
  };
}

export async function search(session: Session, p: SearchParams): Promise<SearchResult> {
  const pageNum = Math.max(1, p.pageNum ?? 1);
  const pageSize = p.pageSize ?? 20;
  const key = queryKey(p);

  // QueryJson carries the raw keyword; URLSearchParams encodes spaces as "+" on the wire.
  const qj = buildQueryJson(p);
  const sortField = p.sort === "time" ? "PT" : "";
  const sortType = p.sort === "time" ? "desc" : "";

  if (pageNum === 1) pagingCache.delete(key);
  const state = pageNum > 1 ? pagingCache.get(key) : undefined;
  if (pageNum > 1 && !state) {
    throw new Error(`page ${pageNum} needs a page-1 call for the same query first (paging token is bound to the result set)`);
  }

  let form: Record<string, string>;
  if (pageNum === 1) {
    form = {
      boolSearch: "true",
      QueryJson: JSON.stringify(qj),
      pageNum: "1",
      pageSize: String(pageSize),
      sortField,
      sortType,
      dstyle: "listmode",
      productStr: "",
      aside: `(${SEARCH_TYPES[p.searchType ?? "SU"]}：${p.keyword})`,
      searchFrom: "资源范围：总库",
      subject: "",
      language: "",
      uniplatform: "",
      CurPage: "1",
    };
  } else {
    // Page 2+ payload, captured verbatim from the real UI.
    // Resource stays CROSSDB; the concrete db list goes into Products.
    const paged = {
      ...(state!.queryJson as Record<string, unknown>),
      Products: state!.dbCodes,
      SearchFrom: 4,
    } as Record<string, unknown>;
    form = {
      boolSearch: "false",
      QueryJson: JSON.stringify(paged),
      pageNum: String(pageNum),
      pageSize: String(pageSize),
      sortField,
      sortType,
      dstyle: "listmode",
      boolSortSearch: "false",
      productStr: "",
      aside: "",
      searchFrom: "资源范围：总库",
      subject: "",
      turnpage: state!.token,
      language: "",
      uniplatform: "",
    };
  }

  const r = await cnkiFetch("/kns8s/brief/grid", session, { method: "POST", form });
  if (r.status !== 200) throw new Error(`brief/grid HTTP ${r.status}`);

  const parsed = parseSearchHtml(r.body);
  if (pageNum === 1 && parsed.turnPageToken) {
    pagingCache.set(key, { token: parsed.turnPageToken, queryJson: qj, dbCodes: PAGE2_DB_CODES });
  }
  log(
    `search "${p.keyword}" ${SEARCH_TYPES[p.searchType ?? "SU"]} page ${pageNum}/${parsed.totalPages} → total=${parsed.total} rows=${parsed.items.length}`,
  );

  let items = parsed.items;
  if (p.resource?.length) items = items.filter((i) => p.resource!.includes(i.dbType as ResourceKind));
  if (p.yearFrom) items = items.filter((i) => (i.year ?? 0) >= p.yearFrom!);
  if (p.yearTo) items = items.filter((i) => (i.year ?? 9999) <= p.yearTo!);

  return { ...parsed, items };
}
