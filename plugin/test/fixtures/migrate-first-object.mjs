/**
 * Migrate the first Research object from directory layout to flat single-file.
 * Also fixes finding 7's evidence mismatch (GitHub Projects claim citing
 * a Notion URL — downgraded to uncertain as unverified).
 */
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = "/Users/dmh2002/DshProject/dsh-ldvh/ldvh-base";
const UID = "d5bd2681-3432-45f8-bf29-f62f2da3c2d2";
const OLD_DIR = join(ROOT, "researches", UID);
const OLD_FILE = join(OLD_DIR, `research-${UID}.md`);
const NEW_FILE = join(ROOT, "researches", `research-${UID}.md`);

async function main() {
  // 1. Read old file
  const content = await readFile(OLD_FILE, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  const frontmatter = parseYaml(fmMatch[1]);
  const body = content.slice(fmMatch[0].length).trim();

  // 2. Fix finding 7: remove the bad confirmed (GitHub claim with Notion source),
  //    add it to uncertain as unverified
  const badStatement = "GitHub Projects 的 roadmap 视图按 milestone 组织，支持按 repository/filter 分组";
  const before = frontmatter.confirmed.length;
  frontmatter.confirmed = frontmatter.confirmed.filter((c) => c.statement !== badStatement);
  const removed = before - frontmatter.confirmed.length;
  console.log("Removed bad confirmed:", removed);

  frontmatter.uncertain.push({
    issue: "GitHub Projects roadmap 视图的结构未获可靠证据",
    reason: "调研子代理曾给出指向 Notion 模板页的错误来源——声明与来源不匹配，判为未证实；需重新调研 GitHub 官方文档",
  });

  // 3. Remove the finding-7 paragraph from body 已证实 section
  const fixedBody = body.replace(
    /### 发现 7：GitHub Projects 的 roadmap[\s\S]*?\[7\]\n\n?/,
    "",
  ).replace(
    "后续：LDVH 蓝图五个待裁决问题的业界依据已获取，可进入 Human 裁决阶段。",
    "后续：LDVH 蓝图五个待裁决问题的业界依据已获取（GitHub Projects 部分证据未证实，待补调研），可进入 Human 裁决阶段。",
  );

  // 4. Append change_log entry for this correction
  frontmatter.change_log.push({
    at: new Date().toISOString(),
    provider: "zzztoken-glm",
    model: "glm-5.3",
    summary: "受控更正：载体从目录迁移为平铺单文件；发现 7（GitHub Projects roadmap 声明指向 Notion 来源）从 confirmed 降级为 uncertain——来源与声明不匹配",
  });

  // 5. Write new flat file
  const newContent = `---\n${stringifyYaml(frontmatter)}---\n\n${fixedBody.trim()}\n`;
  await mkdir(join(ROOT, "researches"), { recursive: true });
  await writeFile(NEW_FILE, newContent, "utf8");

  // 6. Remove old directory
  await rm(OLD_DIR, { recursive: true, force: true });

  console.log("Migrated to:", NEW_FILE);
  console.log("Confirmed:", frontmatter.confirmed.length, "| Uncertain:", frontmatter.uncertain.length, "| change_log:", frontmatter.change_log.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
