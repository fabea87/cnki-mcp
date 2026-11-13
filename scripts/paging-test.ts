import { withSession } from "../src/cnki/session.js";
import { search } from "../src/cnki/search.js";
const kw = process.argv[2] ?? "二语写作 反馈";
for (const n of [1, 2, 3]) {
  const r = await withSession((s) => search(s, { keyword: kw, pageNum: n, pageSize: 10 }));
  console.log(`page ${n}: total=${r.total} pages=${r.totalPages} rows=${r.items.length} first=${r.items[0]?.title.slice(0, 22) ?? "-"}`);
}
