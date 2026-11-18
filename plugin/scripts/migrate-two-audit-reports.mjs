import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createResearchObject } from "../lib/report-writer.js";
import { shellAuthoritativeSignature } from "../lib/session-signature.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(__dirname, "../..");
const FACT_ROOT = resolve(REPO, "ldvh-base");

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(HEAD)) throw new Error(`HEAD is not a 40-hex commit: ${HEAD}`);

function splitFrontmatterAndBody(raw) {
  const lines = raw.split("\n");
  const titleIdx = lines.findIndex((l) => /^title:\s/.test(l));
  if (titleIdx < 0) throw new Error("no title line in archived devlog");
  let start = -1;
  for (let i = titleIdx - 1; i >= 0; i--) {
    if (lines[i] === "---") { start = i + 1; break; }
  }
  if (start < 0) throw new Error("cannot find frontmatter start");
  let end = -1;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (lines[i] === "---") { end = i; break; }
  }
  if (end < 0) throw new Error("cannot find frontmatter end");
  return {
    frontmatter: lines.slice(start, end).join("\n"),
    body: lines.slice(end + 1).join("\n").trim(),
  };
}

function parseSimpleYaml(fm) {
  const out = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function mapToAuditBody(body, sourcePath, originalTitle) {
  const sections = {};
  let current = null;
  let buf = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (current) sections[current] = buf.join("\n").trim();
      current = line.slice(3).trim();
      buf = [];
    } else {
      buf.push(line);
    }
  }
  if (current) sections[current] = buf.join("\n").trim();
  for (const key of ["背景", "做法", "实测", "结论与边界", "去向"]) {
    if (!sections[key]) throw new Error(`source report missing section: ${key}`);
  }

  const background = `### 背景\n\n${sections["背景"]}\n\n### 做法\n\n${sections["做法"]}`;

  const measured = sections["实测"];
  const conclusionMarker = "### 结论（报告原文首段）";
  const markerIdx = measured.indexOf(conclusionMarker);
  if (markerIdx < 0) throw new Error("实测 section missing 结论 H3");
  const afterConclusion = measured.slice(markerIdx + conclusionMarker.length);
  const nextH3 = afterConclusion.search(/\n### /);
  const conclusionText = (nextH3 < 0 ? afterConclusion : afterConclusion.slice(0, nextH3)).trim();
  const remaining = (nextH3 < 0 ? "" : afterConclusion.slice(nextH3 + 1)).trim();
  const evidence = `${remaining}\n\n来源：commit（${HEAD}）`;

  const sourceNote = `本报告迁自 DevLog 存量归档文档 \`${sourcePath}\`（原对象标题：${originalTitle}）。来源交代为普通叙述，不是可解析指针（24 §6.3 条件 4）；上方 commit 锚点指向当前 HEAD 树中该归档文档的逐字原文，永久可回查。逐字照录，未改写结论、编号与原文笔误。`;

  return [
    `## 被审对象与背景\n\n${sourceNote}\n\n${background}`,
    `## 审核结论\n\n${conclusionText}`,
    `## 证据性发现\n\n${evidence}`,
    `## 未覆盖范围与保证边界\n\n${sections["结论与边界"]}`,
    `## 后续处置\n\n${sections["去向"]}`,
  ].join("\n\n") + "\n";
}

async function main() {
  const signature = await shellAuthoritativeSignature();
  if (!signature) throw new Error("no authoritative signature from shell environment — refuse to write (09)");

  const jobs = [
    {
      file: resolve(REPO, "docs/devlog-archive/devlog-1e6f65ec-7356-4f1b-a613-b0c267a863c0.md"),
      title: "observed 状态与定时审核计划独立审核：不可行",
    },
    {
      file: resolve(REPO, "docs/devlog-archive/devlog-c73d79df-dc5a-482c-903f-0125659769b0.md"),
      title: "B′ 留观缓冲方案独立审核：可行但需改动",
    },
  ];

  for (const job of jobs) {
    const raw = await readFile(job.file, "utf8");
    const { body, frontmatter } = splitFrontmatterAndBody(raw);
    const parsed = parseSimpleYaml(frontmatter);
    if (parsed.title !== job.title) throw new Error(`title mismatch: ${parsed.title} != ${job.title}`);
    const auditBody = mapToAuditBody(body, job.file.replace(REPO + "/", ""), job.title);
    const draft = {
      title: job.title,
      status: "active",
      report_form: "audit",
      research_purpose: `承载 ${job.title} 这一次独立审核的完整结论报告，供跨行动引用与复核`,
      stopping_reason: "no-gain",
      gaps: [{
        description: "本报告为 2026-10-20 当时规范文本下的审核结论；报告内数字与规范编号系当日快照，引用前须重新实测并按现名回查（正文「未覆盖范围与保证边界」段已据实声明）",
        priority: "low",
      }],
      change_summary: `从 DevLog 存量归档迁入完整审核报告（原条目 ${parsed.object_uid}，逐字照录并按 audit 5 H2 重排，补 commit 锚点 ${HEAD.slice(0, 8)}）`,
    };
    const created = await createResearchObject({
      factSourceRoot: FACT_ROOT,
      frontmatterDraft: draft,
      analysisBody: auditBody,
      sessionSignature: signature,
    });
    if (!created.ok) {
      console.error(`FAILED ${job.title}:`, JSON.stringify(created.error));
      process.exitCode = 1;
      return;
    }
    console.log(`OK ${job.title} -> ${created.value.object_uid} (${created.value.file})`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
