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

// 五种零检测力形态中**可机械识别**的两种。第五种（答案指向可被废止或改名之
// 事实对象）需语义判断——「这个标题背后是不是一个会被废止的对象」机器读不
// 出来，故不在这里假装识别，只靠人读。少报可以，误报会让人不再信任这个工具。
const RULES = [
  {
    id: "tautology",
    // assert.ok(x || true) / assert.ok(n >= 0) / assert.equal(true, true)
    re: /assert\.\w+\([^\n]*(?:\|\|\s*true|\.length\s*>=\s*0\b|,\s*true,\s*true\b)/g,
    note: "恒真式：表达式永远为真，任何实现都不会让它转红",
  },
];

/**
 * 找出**块内看不到任何断言**的用例块（形态 3 的候选）。
 *
 * 判据取「块内有无断言」这个**语义属性**，不取注释文本——
 * 2026-10-30 独立审核指出：早前版本用注释短语（「不参与断言」等）作识别键，
 * 而那些短语恰恰只出现在注释里，再叠加「跳过注释行」的过滤后**恒不命中**
 * （规则形同虚设）；且它会把「注释解释了意图、块内其实有断言」的合法用例误判。
 *
 * **块内字面无 `assert.` 不等于该用例无断言**，本函数已排除两类情形：
 *
 * 1. **断言写在辅助函数里**：`assertVerbatim(...)`、`assertEnvelopeShape(...)`
 *    等内部做 `assert.`。机械上辅助函数名不可从块内推出，故先收集**本文件内**
 *    自身含 `assert.` 的辅助函数名，把对这些辅助函数的调用也算作有断言。
 * 2. **以「失败即抛出」代替断言**：如 `await git(...)`——git 非零退出即抛，
 *    故「必须成功的 git 步骤」本身就是断言（反例：`gitOk` **不抛错**，返回
 *    `{ok:false}`，用它做「必须成功」的步骤会静默吞掉失败——该用法已在本仓
 *    修掉，见 plugin/test/hook-repair.test.mjs）。
 *
 * 跨文件辅助函数与经变量间接调用无法机械排除，产出仍是**候选**而非确定命中，
 * 须人工确认。**少报可以，误报会让人不再信任这个工具。**
 */
/**
 * 「失败即抛出」的辅助函数——调用它们**本身即断言**：失败会抛，用例转红。
 *
 * 与之相对的是 `gitOk` 与 `runNode`（**都不抛**，返回 `{ok:false}`），它们供
 * 「预期失败」的路径使用；用它们做「必须成功」的步骤会把失败静默吞掉——本仓
 * 已修掉一处（plugin/test/hook-repair.test.mjs 原用 `gitOk`）。故此处只认会抛的
 * `git`。
 *
 * `runNode` 曾误列于此（2026-10-30 独立复审 I1 指出）：它的实现是 try/catch 后
 * 返回 `{ok:false}`（plugin/test/helpers.mjs），**不抛错**。把它当「失败即抛出」
 * 会让「只调 `runNode`、从不看 `.ok`」的用例被漏报——而这正是本文件要检出的形态，
 * 属「声称识别了而其实没有」。已移除。
 */
const THROWING_HELPERS = ["git"];

function findBlocksWithoutAssertions(text) {
  const lines = text.split("\n");
  // 收集本文件内自身含 assert. 的辅助函数名。
  const helperNames = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m === null) continue;
    // 向下扫到函数体结束，看有没有 assert.
    for (let j = i + 1; j < lines.length && j < i + 60; j += 1) {
      if (/^\}/.test(lines[j])) break;
      const l = lines[j];
      if (/^\s*\/\//.test(l) || /^\s*\*/.test(l)) continue;
      if (/\bassert\./.test(l)) { helperNames.add(m[1]); break; }
    }
  }
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    // 块起点：`test(`（缩进允许）。
    //
    // **已知局限**（2026-10-30 第三轮复审 N-F）：多行模板/字符串字面量内部若
    // 恰好在行首出现 `test("...")` 字样，仍会被当作块起点、报出一条**候选**。
    // 试过按真实结构屏蔽字面量与注释来消除它，但本仓文件里的**正则字面量**
    // 会与字符串定界符混淆（正则里的引号被当成串的起点），屏蔽后状态机错位、
    // 把真实用例块也吞掉——实测 client-contract.test.mjs 从第 548 行起整段
    // 漏报、块数 2465→2430。那种**漏报**比这里的误报严重得多，故撤回该做法。
    // 保留此误报面：它只产出「候选」（`no-assert?`），明示须人工确认；且本仓
    // 当前 2465 处 `^\s*test(` 全部是真实用例注册，该形态未出现。
    if (/^\s*test\(/.test(lines[i])) starts.push(i);
  }
  const out = [];
  for (let k = 0; k < starts.length; k += 1) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    let hasAssert = false;
    for (let i = from; i < to; i += 1) {
      const line = lines[i];
      // 注释行里的 assert 只是说明文字，不算断言。
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
      if (/\bassert\./.test(line)) { hasAssert = true; break; }
      // 调用了本文件内自身含 assert. 的辅助函数 → 视为有断言。
      for (const name of helperNames) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(line)) { hasAssert = true; break; }
      }
      if (hasAssert) break;
      // 「失败即抛出」的写法：以抛出代替显式断言。
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
    // 形态 3：块内没有任何断言的用例。
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

/**
 * 数一遍本文件里有多少个用例块（块起点：`test(` 开头的行，**允许缩进**）。
 *
 * 存在的理由是让输出能区分「扫过且没有」与「根本没识别到任何用例块」——
 * 后者说明扫描前提不成立，此时「0 个候选」不构成任何结论。
 *
 * 2026-10-30 复审 I2 指出：原实现只认**列 0** 的 `test(`，而本仓实测有 9 处
 * 缩进 `test(`（governed-projects.test.mjs 5 处、retired-params.test.mjs:72、
 * schema-writer-agreement.test.mjs:202、workcase-plan-gate.test.mjs:49/76），
 * 它们从不成为块边界、被并进前一个列 0 块的窗口，自身有无断言**不被检查**；
 * 覆盖计数也只数列 0，无法暴露这处漏扫。已改为允许缩进。
 *
 * 仍不覆盖：`describe(...)` 内的子测试若由别的始发形式组织、以及经变量间接
 * 注册的用例。该局限随输出一并披露。
 */
function countTestBlocks(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (/^\s*test\(/.test(line)) n += 1;
  }
  return n;
}

const { findings, stats } = await scan();
// **零块守卫必须在任何输出分支之前**（2026-10-30 复审 N2）：
// 原来它排在 `--json` 分支之后，于是机器可读模式恰恰绕过了这个守卫——
// 而 CI/门禁消费的正是机器可读模式，等于把「没识别到用例块」输出成
// `count: 0` 加 exit 0，正是 I2 声称要避免的那种「把未覆盖说成未发现」。
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
