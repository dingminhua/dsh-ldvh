#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test");

const RULES = [
  {
    id: "tautology",
    re: /assert\.\w+\([^\n]*(?:\|\|\s*true|\.length\s*>=\s*0\b|,\s*true,\s*true\b)/g,
    note: "恒真式：表达式永远为真，任何实现都不会让它转红",
  },
];

const THROWING_HELPERS = ["git"];

function findBlocksWithoutAssertions(text) {
  const lines = text.split("\n");
  const helperNames = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m === null) continue;
    for (let j = i + 1; j < lines.length && j < i + 60; j += 1) {
      if (/^\}/.test(lines[j])) break;
      const l = lines[j];
      if (/^\s*\/\//.test(l) || /^\s*\*/.test(l)) continue;
      if (/\bassert\./.test(l)) { helperNames.add(m[1]); break; }
    }
  }
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*test\(/.test(lines[i])) starts.push(i);
  }
  const out = [];
  for (let k = 0; k < starts.length; k += 1) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    let hasAssert = false;
    for (let i = from; i < to; i += 1) {
      const line = lines[i];
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
      if (/\bassert\./.test(line)) { hasAssert = true; break; }
      for (const name of helperNames) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(line)) { hasAssert = true; break; }
      }
      if (hasAssert) break;
      for (const name of THROWING_HELPERS) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(line)) { hasAssert = true; break; }
      }
      if (hasAssert) break;
    }
    if (hasAssert) continue;
    const name = (/^\s*test\(\s*["'`]([^"'`]{0,70})/.exec(lines[from]) ?? [])[1] ?? "(匿名)";
    out.push({ line: from + 1, name, snippet: lines[from].trim().slice(0, 110) });
  }
  return out;
}

async function scan() {
  const files = (await readdir(TEST_DIR)).filter((f) => f.endsWith(".mjs"));
  const findings = [];
  const stats = { files: 0, blocks: 0 };
  for (const f of files) {
    const text = await readFile(join(TEST_DIR, f), "utf8");
    stats.files += 1;
    const lines = text.split("\n");
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split("\n").length;
        const textLine = lines[line - 1] ?? "";
        const isComment = /^\s*\/\//.test(textLine) || /^\s*\*/.test(textLine);
        if (isComment) continue;
        findings.push({
          file: f,
          line,
          rule: rule.id,
          note: rule.note,
          snippet: textLine.trim().slice(0, 110),
        });
      }
    }
    const blocks = findBlocksWithoutAssertions(text);
    stats.blocks += countTestBlocks(text);
    for (const b of blocks) {
      findings.push({
        file: f,
        line: b.line,
        rule: "no-assert?",
        note: "**候选**：块内看不到断言——但断言可能写在辅助函数里（如 assertVerbatim 内部做 assert），"
          + "须人工确认该用例（含其辅助函数）确无断言后，才属形态 3「无断言的用例」",
        snippet: b.snippet,
      });
    }
  }
  return { findings, stats };
}

function countTestBlocks(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (/^\s*test\(/.test(line)) n += 1;
  }
  return n;
}

const { findings, stats } = await scan();
if (stats.blocks === 0) {
  const message = `扫描了 ${stats.files} 个测试文件，但**未识别到任何用例块**——`
    + "本次结果不构成任何结论（不是「未发现零检测力断言」）。";
  console.error(message);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ error: "no test blocks", findings: [], count: null, stats }, null, 2));
  }
  process.exitCode = 1;
} else if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ findings, count: findings.length, stats }, null, 2));
} else if (findings.length === 0) {
  console.log(
    `扫描 ${stats.files} 个文件 / ${stats.blocks} 个用例块：未发现可机械识别的零检测力断言`
    + `（形态 5「答案指向可被废止或改名之事实对象」需人读判定，见 specs/06 §5）。`
    + "注意：「未发现」只说明未命中可机械识别的形态，不证明不存在零检测力断言；"
    + "describe 内的子测试与经变量间接注册的用例不在扫描范围内。",
  );
} else {
  console.log(`扫描 ${stats.files} 个文件 / ${stats.blocks} 个用例块，发现 ${findings.length} 处待判项：\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.note}`);
    console.log(`    ${f.snippet}`);
  }
  console.log(
    "\n处置依据：specs/06 §5「断言的检测力须可证」。这不是门禁，只报告不阻断。\n"
    + "带「?」的规则号表示**候选**而非确定命中——断言可能写在辅助函数里，机械上无法区分，须人工确认。",
  );
}
