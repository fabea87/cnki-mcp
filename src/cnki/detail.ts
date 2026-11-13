/**
 * Abstract-page parser (/kcms2/article/abstract?v=…).
 *
 * Layout: `.doc-top .top-tip` holds "刊名 . 年 ,卷 (期) : 起-止";
 * `.brief` holds title/authors/institution; `.row` blocks hold labelled fields.
 */
import { parseHTML } from "linkedom";
import { cnkiFetch, type Session } from "./http.js";

export type PaperDetail = {
  title: string;
  authors: string[];
  institutions: string[];
  journal: string;
  year: number | null;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  abstract: string;
  keywords: string[];
  funds: string[];
  clc: string;
  disciplines: string;
  onlineDate: string;
  url: string;
  /** Fields the page did not carry (e.g. 网络首发 items lack 卷/期/页). */
  missing: string[];
};

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Labelled fields live either as `<div class="row"><span class="rowtit">标签：</span>…`
 * or as `<li><span class="rowtit">标签：</span><p>值</p></li>`. Walk every rowtit and
 * read only its own container, so a DOI never swallows the following metadata.
 */
function labelMap(document: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const tit of document.querySelectorAll(".rowtit")) {
    const label = clean(tit.textContent).replace(/[:：]\s*$/, "");
    if (!label || map.has(label)) continue;
    const holder = tit.parentElement;
    if (!holder) continue;
    const clone = holder.cloneNode(true) as Element;
    clone.querySelector(".rowtit")?.remove();
    // Nested blocks (e.g. the whole .row wrapping a <ul>) would include siblings.
    if (clone.querySelector("li")) {
      const own = holder.nextElementSibling;
      if (own) map.set(label, clean(own.textContent));
      continue;
    }
    map.set(label, clean(clone.textContent));
  }
  return map;
}

export function parseDetailHtml(html: string, url: string): PaperDetail {
  const { document } = parseHTML(html);

  const title = clean(document.querySelector(".brief .wx-tit h1")?.textContent)
    .replace(/附视频$/, "")
    .trim();

  const authors: string[] = [];
  const institutions: string[] = [];
  for (const h3 of document.querySelectorAll(".brief h3.author")) {
    const names = [...h3.querySelectorAll("a")].map((a) => clean(a.textContent)).filter(Boolean);
    if (h3.getAttribute("id") === "authorpart") authors.push(...names);
    else institutions.push(...names);
  }

  // "刊名 . 2026 ,8 (04) : 22-33"
  const tip = clean(document.querySelector(".doc-top .top-tip")?.textContent);
  const journal = clean(tip.split(".")[0]);
  const year = /(\d{4})\s*,/.exec(tip)?.[1] ?? /(\d{4})/.exec(tip)?.[1] ?? null;
  const volume = /,\s*(\d+)\s*\(/.exec(tip)?.[1] ?? "";
  const issue = /\((\d+)\)/.exec(tip)?.[1] ?? "";
  const pages = /:\s*([\dA-Za-z]+\s*[-–]\s*[\dA-Za-z]+)/.exec(tip)?.[1] ?? "";

  const labels = labelMap(document);
  const pick = (k: string): string => labels.get(k) ?? "";
  const doi = pick("DOI");
  const abstract = clean(
    document.querySelector("#ChDivSummary")?.textContent ??
      document.querySelector('input#abstract_text')?.getAttribute("value"),
  );
  const keywords = [...document.querySelectorAll(".keywords a")]
    .map((a) => clean(a.textContent).replace(/[;；,，]+$/, ""))
    .filter(Boolean);
  const funds = [...document.querySelectorAll(".funds a")].map((a) => clean(a.textContent)).filter(Boolean);

  return {
    title,
    authors,
    institutions,
    journal,
    year: year ? Number(year) : null,
    volume,
    issue: issue.replace(/^0+(?=\d)/, ""),
    pages,
    doi,
    abstract,
    keywords,
    funds,
    clc: pick("分类号"),
    disciplines: pick("专辑"),
    onlineDate: pick("在线公开时间"),
    url,
    missing: [],
  };
}

export function looksLikeDetail(html: string): boolean {
  return html.includes('class="brief"') || html.includes("ChDivSummary");
}

export type DetailHint = { journal?: string; date?: string };

export async function getDetail(session: Session, url: string, hint: DetailHint = {}): Promise<PaperDetail> {
  const r = await cnkiFetch(url, session, { headers: { Accept: "text/html,application/xhtml+xml" } });
  if (r.status !== 200) throw new Error(`detail HTTP ${r.status}`);
  if (!looksLikeDetail(r.body)) {
    throw new Error("detail page layout not recognised (page may be a redirect / login wall)");
  }
  const d = parseDetailHtml(r.body, url);
  // 网络首发 pages carry no journal/date; recover them from the search row when given.
  if (!d.journal && hint.journal) d.journal = hint.journal;
  if (!d.year && hint.date) {
    const y = /(\d{4})/.exec(hint.date)?.[1];
    if (y) d.year = Number(y);
  }
  if (!d.journal) d.missing.push("journal");
  if (!d.year) d.missing.push("year");
  if (!d.volume) d.missing.push("volume");
  if (!d.issue) d.missing.push("issue");
  if (!d.pages) d.missing.push("pages");
  if (!d.doi) d.missing.push("doi");
  return d;
}
