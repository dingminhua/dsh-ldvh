// Spark 载体内聚冗余度量（可复现）。
//
// 口径：正文（自 H2 起，H1 由 title 生成故不计）中被
// summary / question / scope_boundary 三字段**逐字覆盖**的字节占比。
// 重复出现按次数累计。占比上限 1.0。
//
// 注意：这是**上界估计**——只按「字段原串在正文中出现」计，
// 不判断该次出现是否真的在承担「展开」角色。
// 故它偏高而非偏低，用它判断「冗余是否存在」是保守的（不会漏报）。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const DIR = "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base/sparks";

function splitCarrier(text) {
  const parts = text.split(/^---$/m);
  if (parts.length < 3) return null;
  let fm;
  try { fm = parseYaml(parts[1]); } catch { return null; }
  if (fm === null || typeof fm !== "object") return null;
  return { frontmatter: fm, body: parts.slice(2).join("---") };
}

function bodyFrom(fullBody) {
  const lines = fullBody.trim().split("\n");
  // H1 由 title 生成，不属作者撰写的正文
  if (lines[0] && lines[0].startsWith("# ")) lines.shift();
  return lines.join("\n").trim();
}

export function measure(dir = DIR) {
  const rows = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const carrier = splitCarrier(readFileSync(join(dir, name), "utf8"));
    if (carrier === null) continue;
    const { frontmatter: fm } = carrier;
    if (!["open", "implemented", "discarded"].includes(fm.status)) continue;
    const body = bodyFrom(carrier.body);
    if (body.length === 0) continue;
    const fields = ["summary", "question", "scope_boundary"]
      .map((k) => fm[k])
      .filter((v) => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());
    let covered = 0;
    for (const field of fields) {
      let from = 0;
      for (;;) {
        const at = body.indexOf(field, from);
        if (at < 0) break;
        covered += field.length;
        from = at + field.length;
      }
    }
    rows.push({
      id: name.replace(/^spark-/, "").slice(0, 8),
      status: fm.status,
      summaryLen: typeof fm.summary === "string" ? fm.summary.length : 0,
      bodyLen: body.length,
      ratio: Math.min(covered / body.length, 1),
    });
  }
  return rows;
}

function pct(n) { return `${Math.round(n * 100)}%`; }

const rows = measure();
rows.sort((a, b) => b.ratio - a.ratio);

const med = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

console.log(`样本：${rows.length} 个 Spark（open/implemented/discarded）\n`);
console.log(`正文重复占比  中位 ${pct(med(rows.map((r) => r.ratio)))}  平均 ${pct(rows.reduce((s, r) => s + r.ratio, 0) / rows.length)}`);
console.log(`≥80% 的对象：${rows.filter((r) => r.ratio >= 0.8).length} 个`);
console.log(`≥60% 的对象：${rows.filter((r) => r.ratio >= 0.6).length} 个`);
console.log(`≥50% 的对象：${rows.filter((r) => r.ratio >= 0.5).length} 个\n`);

for (const st of ["open", "implemented", "discarded"]) {
  const g = rows.filter((r) => r.status === st);
  if (g.length === 0) continue;
  console.log(`${st.padEnd(12)} n=${String(g.length).padStart(3)}  中位 ${pct(med(g.map((r) => r.ratio)))}`);
}

const short = rows.filter((r) => r.summaryLen <= 500);
const long = rows.filter((r) => r.summaryLen > 500);
console.log(`\nsummary≤500 字  n=${short.length}  中位 ${pct(med(short.map((r) => r.ratio)))}`);
console.log(`summary >500 字  n=${long.length}  中位 ${pct(med(long.map((r) => r.ratio)))}`);

console.log("\n重复占比最高的 6 个：");
for (const r of rows.slice(0, 6)) {
  console.log(`  ${r.id}  ${pct(r.ratio).padStart(4)}  ${r.status.padEnd(12)} summary=${r.summaryLen} 字  body=${r.bodyLen} 字`);
}
