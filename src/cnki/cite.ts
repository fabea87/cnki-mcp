/** Citation formatters built from parsed fields — no dependence on CNKI's own export. */
import type { PaperDetail } from "./detail.js";

export type CiteStyle = "gb7714" | "apa" | "bibtex" | "ris";

const maxNames = 3;

function cnAuthors(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length <= maxNames) return authors.join(", ");
  return `${authors.slice(0, maxNames).join(", ")}, 等`;
}

function enAuthors(authors: string[]): string {
  if (authors.length === 0) return "";
  return authors.join(", ");
}

function splitPages(pages: string): { start: string; end: string } {
  const m = /^(.+?)\s*[-–]\s*(.+)$/.exec(pages.trim());
  return m ? { start: m[1]!.trim(), end: m[2]!.trim() } : { start: pages.trim(), end: "" };
}

/** 网络首发 items have no volume/issue yet — say so instead of emitting ", ." */
function pubStmt(p: PaperDetail): string {
  if (!p.year && !p.volume && !p.issue) return "[网络首发]";
  const parts: string[] = [];
  if (p.year) parts.push(String(p.year));
  if (p.volume) parts.push(p.volume);
  let s = parts.join(", ");
  if (p.issue) s += `(${p.issue})`;
  if (p.pages) s += `: ${p.pages}`;
  return s;
}

export function formatGb7714(p: PaperDetail): string {
  const doi = p.doi ? `. DOI: ${p.doi}.` : ".";
  return `${cnAuthors(p.authors)}. ${p.title}[J]. ${p.journal || "[刊名缺失]"}, ${pubStmt(p)}${doi}`;
}

export function formatApa(p: PaperDetail): string {
  const year = p.year ? `(${p.year})` : "(in press)";
  const vol = p.volume ? `, ${p.volume}` : "";
  const iss = p.issue ? `(${p.issue})` : "";
  const pages = p.pages ? `, ${p.pages}` : "";
  const doi = p.doi ? ` https://doi.org/${p.doi}` : "";
  return `${enAuthors(p.authors)} ${year}. ${p.title}. ${p.journal}${vol}${iss}${pages}.${doi}`;
}

export function formatBibtex(p: PaperDetail, key?: string): string {
  const k =
    key ??
    `${p.authors[0] ?? "anon"}${p.year ?? ""}${p.title.slice(0, 6).replace(/[\s\p{P}]/gu, "")}`;
  const fields: Array<[string, string]> = [
    ["title", p.title],
    ["author", p.authors.join(" and ")],
    ["journal", p.journal],
    ["year", String(p.year ?? "")],
    ["volume", p.volume],
    ["number", p.issue],
    ["pages", p.pages.replace(/\s*[-–]\s*/, "--")],
    ["doi", p.doi],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k2, v]) => `  ${k2.padEnd(8)} = {${v}}`)
    .join(",\n");
  return `@article{${k},\n${body}\n}`;
}

export function formatRis(p: PaperDetail): string {
  const { start, end } = splitPages(p.pages);
  const lines: string[] = [
    "TY  - JOUR",
    `TI  - ${p.title}`,
    ...p.authors.map((a) => `AU  - ${a}`),
    `JO  - ${p.journal}`,
    `PY  - ${p.year ?? ""}`,
    p.volume ? `VL  - ${p.volume}` : "",
    p.issue ? `IS  - ${p.issue}` : "",
    start ? `SP  - ${start}` : "",
    end ? `EP  - ${end}` : "",
    p.doi ? `DO  - ${p.doi}` : "",
    p.abstract ? `AB  - ${p.abstract}` : "",
    ...p.keywords.map((k) => `KW  - ${k}`),
    `UR  - ${p.url}`,
    "ER  - ",
  ].filter(Boolean);
  return lines.join("\n");
}

export function formatCite(p: PaperDetail, style: CiteStyle): string {
  switch (style) {
    case "gb7714":
      return formatGb7714(p);
    case "apa":
      return formatApa(p);
    case "bibtex":
      return formatBibtex(p);
    case "ris":
      return formatRis(p);
  }
}
