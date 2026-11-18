
import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { recallForAction, INJECTION_EXCLUDED_TYPES } from "../lib/source-recall.js";
import { skipWithoutCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

import { QUALITY_CASES, isRelated } from "./recall-quality-cases.mjs";

export { QUALITY_CASES, isRelated };

export async function runCase(c, limit = 3) {
  const r = await recallForAction({
    action: c.q,
    root: ROOT,
    limit,
    budgetBytes: 10240,
    includeSpecs: true,
    excludeTypes: INJECTION_EXCLUDED_TYPES,
  });
  if (r.ok !== true) {
    return { n: 0, relevant: 0, hit: c.want.length === 0 ? true : false, titles: [] };
  }
  const titles = [...(r.specs ?? []), ...(r.facts ?? [])].map((x) => x.title);
  const relevant = titles.filter((t) => isRelated(t, c.want)).length;
  const hit = c.want.length === 0
    ? titles.length === 0
    : titles.some((t) => isRelated(t, c.want));
  return { n: titles.length, relevant, hit, titles };
}

export async function runSuite(limit = 3) {
  let n = 0;
  let relevant = 0;
  let hits = 0;
  let topicCases = 0;
  let quietCases = 0;
  let quietClean = 0;
  const rows = [];
  for (const c of QUALITY_CASES) {
    const r = await runCase(c, limit);
    n += r.n;
    relevant += r.relevant;
    if (c.want.length > 0) {
      topicCases += 1;
      if (r.hit) hits += 1;
    } else {
      quietCases += 1;
      if (r.n === 0) quietClean += 1;
    }
    rows.push({ q: c.q, ...r, want: c.want.length });
  }
  return {
    rows,
    lines: n,
    relevant,
    precision: n === 0 ? 0 : relevant / n,
    topicCases,
    hits,
    quietCases,
    quietClean,
  };
}

const BASELINE = {
  limit3: { lines: 61, relevant: 4, hits: 4, topicCases: 7, quietClean: 1 },
};

test("质量基线（limit=3）：精确率与命中数不得低于记录值", async (t) => {
	if (await skipWithoutCorpus(t)) return;
  const s = await runSuite(3);
  const detail = s.rows
    .map((r) => `  ${r.hit ? "✔" : "✘"} ${r.q.slice(0, 26).padEnd(28)} ${r.relevant}/${r.n}`)
    .join("\n");
  assert.ok(
    s.precision >= BASELINE.limit3.relevant / BASELINE.limit3.lines - 0.001,
    `精确率倒退：${(s.precision * 100).toFixed(1)}% < 基线 `
    + `${((BASELINE.limit3.relevant / BASELINE.limit3.lines) * 100).toFixed(1)}%\n${detail}`,
  );
  assert.ok(
    s.hits >= BASELINE.limit3.hits,
    `主题类命中倒退：${s.hits}/${s.topicCases} < 基线 ${BASELINE.limit3.hits}/${BASELINE.limit3.topicCases}\n${detail}`,
  );
  test.diagnostic?.(`limit=3 实测：${s.relevant}/${s.lines} = ${(s.precision * 100).toFixed(1)}%，`
    + `主题命中 ${s.hits}/${s.topicCases}，无主题干净 ${s.quietClean}/${s.quietCases}`);
});

test("无主题查询不得大量注入（当前为已知缺陷，记录真实值）", async () => {
  const s = await runSuite(3);
  const quietLines = s.rows.filter((r) => r.want === 0).reduce((a, r) => a + r.n, 0);
  const quietCeiling = 22;
  assert.ok(
    quietLines <= quietCeiling,
    `无主题查询共注入 ${quietLines} 行，超过上限 ${quietCeiling}——这是「为了给而给」的直接度量`,
  );
});
