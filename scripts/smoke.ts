/**
 * End-to-end smoke test without the MCP layer.
 * Usage: node dist/scripts/smoke.js [keyword]
 */
import { withSession } from "../src/cnki/session.js";
import { search } from "../src/cnki/search.js";
import { getDetail } from "../src/cnki/detail.js";
import { formatCite } from "../src/cnki/cite.js";

const keyword = process.argv[2] ?? "语料库语言学";

const res = await withSession((s) => search(s, { keyword, pageSize: 10 }));
console.log(`total=${res.total} pages=${res.totalPages} rows=${res.items.length}`);
for (const it of res.items.slice(0, 3)) {
  console.log(` - [${it.date}] ${it.title.slice(0, 40)}… | ${it.journal} | 被引${it.cited ?? "-"} 下载${it.downloads ?? "-"}`);
}

const first = res.items[0];
if (first) {
  const d = await withSession((s) => getDetail(s, first.url));
  console.log("\nDETAIL", {
    title: d.title.slice(0, 50),
    authors: d.authors,
    journal: d.journal,
    py: `${d.year} ${d.volume}(${d.issue}) ${d.pages}`,
    doi: d.doi,
    kw: d.keywords,
    funds: d.funds.length,
    abstractLen: d.abstract.length,
  });
  console.log("\nGB/T 7714:", formatCite(d, "gb7714"));
  console.log("APA      :", formatCite(d, "apa"));
  console.log("\nBibTeX:\n" + formatCite(d, "bibtex"));
}
