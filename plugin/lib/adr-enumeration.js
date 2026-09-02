// dsh-ldvh — active-ADR resident enumeration renderer (batch 3 content side).
//
// Authority: specs/03 §8.2 amendment "F1 常驻枚举" (Human Gate draft v2,
// 2026-09-03): the ONLY resident content is active ADR decision/applicability
// summaries. This module renders that block by scanning the governed
// project's ldvh-base/adrs/ DIRECTLY on every call — no cache, no index, no
// second data source (读写总纲 §2.3.1: 程序化读, 直扫权威 YAML).
//
// Boundaries enforced here:
//   - enumeration, not recall: every active ADR is listed; no relevance
//     judgement, no semantic filtering, no scoring;
//   - summary fields only (title / decision / applicability), never the
//     full body — F3 expansion stays with read-fact-objects;
//   - unreadable/invalid objects are reported as a partial marker, never
//     silently dropped (03 §8.1 observability) and never guessed;
//   - no adrs directory / zero active ADRs -> empty block (the caller
//     suppresses injection entirely);
//   - prompt-safety: rendered text is escaped for the system-prompt
//     interpolation layer ({{ must not be parsed as a template variable,
//     mnemon memoryPromptText lesson).

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const MAX_ADR_LINE = 200; // per-field budget: one line, hard-truncated with ellipsis marker
const MAX_BLOCK_OBJECTS = 20; // partial boundary: beyond this, report truncation honestly

/** Collapse whitespace/newlines and hard-truncate to the per-field budget. */
function oneLine(value) {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.length <= MAX_ADR_LINE ? collapsed : `${collapsed.slice(0, MAX_ADR_LINE - 1)}…`;
}

/** Escape system-prompt interpolation openers ({{) in untrusted text. */
export function escapePromptText(value) {
  return value.replaceAll("{{", "{​{");
}

/**
 * Scan ldvh-base/adrs/*.yaml and render the resident enumeration block.
 * Returns { text, digest, active, truncated, problems } — text is null when
 * there is nothing to inject (no directory, no active ADR). `digest` covers
 * the full rendered text so callers can skip re-injection when unchanged.
 */
export async function renderActiveAdrEnumeration(projectRoot) {
  const adrsDir = join(projectRoot, "ldvh-base", "adrs");
  let entries;
  try {
    entries = await readdir(adrsDir);
  } catch {
    return { text: null, digest: null, active: 0, truncated: false, problems: [] };
  }
  const files = entries.filter((name) => name.endsWith(".yaml") || name.endsWith(".yml")).sort();
  const adrs = [];
  const problems = [];
  for (const file of files) {
    let document;
    try {
      document = parseYaml(await readFile(join(adrsDir, file), "utf8"));
    } catch (error) {
      problems.push({ file, issue: `unparseable: ${String(error?.message ?? error)}` });
      continue;
    }
    if (document === null || typeof document !== "object" || document.status !== "active") continue;
    const title = oneLine(document.title) ?? file;
    const decision = oneLine(document.decision);
    const applicability = oneLine(document.applicability);
    adrs.push({
      ref: typeof document.object_id === "string" ? document.object_id : file,
      title,
      decision,
      applicability
    });
  }
  if (adrs.length === 0) {
    return { text: null, digest: null, active: 0, truncated: false, problems };
  }
  const shown = adrs.slice(0, MAX_BLOCK_OBJECTS);
  const truncated = adrs.length > shown.length;
  const lines = ["【LDVH active ADR 常驻枚举】本项目以下 ADR 处于 active（枚举非召回，不含相关性判断；完整内容与适用核对经 ldvh 读取工具）:"];
  for (const adr of shown) {
    lines.push(`- ${adr.ref} 《${adr.title}》`);
    if (adr.decision !== null) lines.push(`  决定: ${adr.decision}`);
    if (adr.applicability !== null) lines.push(`  适用: ${adr.applicability}`);
  }
  if (truncated) lines.push(`（另有 ${adrs.length - shown.length} 个 active ADR 未列出——partial；完整清单经读取工具分页获取）`);
  for (const problem of problems) lines.push(`（${problem.file} 读取失败: ${problem.issue}——未纳入枚举，未猜测内容）`);
  const raw = lines.join("\n");
  const digest = createHash("sha256").update(raw, "utf8").digest("hex");
  return { text: escapePromptText(raw), digest, active: adrs.length, truncated, problems };
}
