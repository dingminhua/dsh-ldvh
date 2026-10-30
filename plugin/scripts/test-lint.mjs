#!/usr/bin/env node
// 零检测力断言扫描（specs/06 §5「断言的检测力须可证」的机械入口）
//
// **这不是门禁**：只报告、不阻断提交。用途是把「本次新增/修改的断言有没有检测力」
// 从「靠人记得检查」变成「一条命令看得见」。是否处置由 06 §5 与 Human 判定。
//
// 用法：
//   node scripts/test-lint.mjs            # 扫描 test/
//   node scripts/test-lint.mjs --json     # 机器可读
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "test");

// 五种零检测力形态中**可机械识别**的四种。第五种（答案会失效的评测项）需语义
// 判断——「这个标题背后是不是一个会被销账的事实对象」机器读不出来，故不在这里
// 假装识别，只靠人读。少报可以，误报会让人不再信任这个工具。
const RULES = [
  {
    id: "tautology",
    // assert.ok(x || true) / assert.ok(n >= 0) / assert.equal(true, true)
    re: /assert\.\w+\([^\n]*(?:\|\|\s*true|\.length\s*>=\s*0\b|,\s*true,\s*true\b)/g,
    note: "恒真式：表达式永远为真，任何实现都不会让它转红",
  },
  {
    id: "no-assert",
    // 注释自述「不做断言」「只要求不崩」「不参与断言」
    re: /(不做断言|只要求不崩|不参与断言|暂不断言)/g,
    note: "自述无断言：调用不抛异常属 smoke，不是规则守护",
  },
];

async function scan() {
  const files = (await readdir(TEST_DIR)).filter((f) => f.endsWith(".mjs"));
  const findings = [];
  for (const f of files) {
    const text = await readFile(join(TEST_DIR, f), "utf8");
    const lines = text.split("\n");
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split("\n").length;
        // 命中若在注释行里（以 // 开头），多为**解释该形态已删除**的说明文字，
        // 不是活的断言——跳过，避免把「我们删掉了它」的地方再报一遍。
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
  }
  return findings;
}

const findings = await scan();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ findings, count: findings.length }, null, 2));
} else if (findings.length === 0) {
  console.log(
    "未发现可机械识别的零检测力断言（第五种形态「答案会失效的评测项」需人读判定，见 specs/06 §5）",
  );
} else {
  console.log(`发现 ${findings.length} 处可疑断言：\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  [${f.rule}]  ${f.note}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("\n处置依据：specs/06 §5「断言的检测力须可证」。这不是门禁，只报告不阻断。");
}
