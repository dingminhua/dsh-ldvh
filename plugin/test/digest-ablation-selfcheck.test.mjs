
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "recall-digest-ablation.mjs");
const CORPUS = join(import.meta.dirname, "..", "..", "ldvh-base");

async function loadStripPattern() {
  const source = await readFile(SCRIPT, "utf8");
  const match = /const STRIP_PATTERN = (\/.*?\/gm);/.exec(source);
  assert.ok(match !== null, "脚本必须导出/声明 STRIP_PATTERN 常量");
  return eval(match[1]);
}

test("剥离正则：frontmatter 末行（无尾随换行）也必须被删掉", async () => {
  const STRIP = await loadStripPattern();
  const carrier = [
    "---",
    "title: 夹具",
    "status: open",
    "recall_digest: 预算裁剪 结论反转",
    "---",
    "",
    "# 夹具",
    "",
  ].join("\n");
  const stripped = carrier.replace(STRIP, "");
  assert.ok(!/^recall_digest:/m.test(stripped), "末行 digest 键必须被删除");
  assert.ok(!stripped.includes("预算裁剪"), "digest 的词面必须一并消失");
  assert.ok(stripped.includes("title: 夹具"), "其它 frontmatter 键必须保留");
  assert.ok(stripped.includes("status: open"), "其它 frontmatter 键必须保留");
  assert.ok(stripped.includes("# 夹具"), "正文必须保留");
});

test("剥离正则：中间行与 CRLF 形态都要删干净", async () => {
  const STRIP = await loadStripPattern();
  const mid = ["---", "title: 甲", "recall_digest: 甲词 乙词", "status: open", "---", "", "# 甲", ""].join("\n");
  assert.ok(!mid.replace(STRIP, "").includes("甲词"), "中间行 digest 必须删除");

  const crlf = "---\r\ntitle: 乙\r\nrecall_digest: 丙词\r\n---\r\n\r\n# 乙\r\n";
  const crlfStripped = crlf.replace(STRIP, "");
  assert.ok(!crlfStripped.includes("丙词"), "CRLF 载体里的 digest 也必须删除");
  assert.ok(crlfStripped.includes("title: 乙"), "CRLF 载体的其它键必须保留");
});

test("真实语料：剥离后每个载体都不得残留 recall_digest 键", async () => {
  let dirs = [];
  try { dirs = await readdir(CORPUS); } catch { return; }

  const STRIP = await loadStripPattern();
  const temp = await mkdtemp(join(tmpdir(), "ldvh-strip-selfcheck-"));
  try {
    const files = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith(".md")) files.push(path);
      }
    };
    await walk(CORPUS);
    if (files.length === 0) return;

    const survivors = [];
    for (const path of files) {
      const source = await readFile(path, "utf8");
      const stripped = source.replace(STRIP, "");
      if (source === stripped) continue;
      if (/^[ \t]*recall_digest:/m.test(stripped)) survivors.push(path);
    }
    assert.deepEqual(survivors, [], `剥离后仍残留 recall_digest 的载体：${survivors.slice(0, 5).join(", ")}`);
  } finally {
    if (temp.startsWith(join(tmpdir(), "ldvh-strip-selfcheck-"))) {
      await rm(temp, { recursive: true, force: true });
    } else {
      process.stderr.write(`[warn] 临时目录路径不符预期，拒绝删除：${temp}\n`);
    }
  }
});

test("脚本头边界以具名常量与报告字段承载（不留解释性注释）", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("corpusFingerprint"), "报告必须带语料指纹");
  assert.ok(
    source.includes("拒绝用未真正移除的语料测量"),
    "剥离后残留必须 throw，而不是继续测量",
  );
});

test("脚本不得 import 测试文件（否则跑一次消融会连带执行整组断言）", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(
    !source.includes('from "../test/recall-quality.test.mjs"'),
    "消融脚本不得导入测试文件；评测集应来自 recall-quality-cases.mjs",
  );
  assert.ok(
    source.includes('from "../test/recall-quality-cases.mjs"'),
    "评测集必须来自共享数据源，保证与质量基线同口径",
  );
});

test("工具提供迁移可行性验证模式（把词面并入权威字段）", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("--migration-check"), "必须提供 --migration-check 入口");
  assert.ok(
    source.includes("trigger_signal"),
    "迁移目标须是仍在匹配面上的权威字段，而不是新造字段",
  );
  assert.ok(
    source.includes("不证明写入器/规范已支持该迁移"),
    "必须如实声明该模式不构成迁移已完成",
  );
});

test("探针报告必须按类型给出迁移可行性，而不是只报全局丢失数", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("probeTypeBreakdown"), "必须按类型汇总探针结果");
  assert.ok(source.includes("hasMigrationTarget"), "每个类型须标记是否有可迁入字段");
  assert.ok(
    source.includes("TRIGGER_CAPABLE_TYPES"),
    "可迁入类型的判据须是具名常量（23 §8 采用 trigger_signal）",
  );
  assert.ok(
    /TRIGGER_CAPABLE_TYPES\s*=\s*new Set\(\[[^\]]*"pitfall"/s.test(source),
    "可迁入类型当前只有 pitfall（ADR 撤除后）——其余类型闭集无 trigger_signal",
  );
  assert.ok(source.includes("无迁移目标"), "报告须显式点出无迁移目标的损失");
});

test("脚本提供全量模式（--all-probes）", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("--all-probes"), "必须提供 --all-probes 全量模式");
});


test("断言「失去可达」必须区分信息缺失与匹配机制，否则会指错修复方向", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("classifyLostProbes"), "必须对丢失探针做成因分类");
  assert.ok(source.includes("lossNature"), "报告必须带成因分类结果");
  for (const key of ["nowhere", "bodyOnly", "inOtherField"]) {
    assert.ok(source.includes(key), `成因分类必须含 ${key}`);
  }
  assert.ok(
    source.includes("minHits"),
    "须在分类说明里点名正文层 minHits 门槛，读者才知道「机制问题」指什么",
  );
});

test("异步分类必须被 await——否则报告里会静默出现 [object Promise]", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(
    /lossNature:\s*await\s+classifyLostProbes\(/.test(source),
    "classifyLostProbes 是 async 函数，赋值给报告字段时必须 await",
  );
});

test("limit 参与判据：运行输出须提示前 limit 条之外不等于不可召回", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(
    source.includes("不等于对象不可召回"),
    "运行输出须提示「不在前 limit 条」不等于「不可召回」",
  );
});

test("对象级可达性与词面级可达性必须分开测量", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("--object-reachability"), "必须提供对象级可达性模式");
  assert.ok(source.includes("objectsUnreachable"), "报告须给出「整体不可达对象数」");
  assert.ok(
    source.includes("两件事"),
    "代码须写明对象级与词面级是两种损失，不可互相替代",
  );
});

test("被入口类型排除的对象必须记作「未测量」而非「不可达」", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("notCoveredByEntry"), "报告须单列本入口未覆盖的对象数");
  assert.ok(
    source.includes("pitfall-97d65fb9"),
    "须在代码里指向该踩坑记录，使后来者知道为何要摘出来",
  );
  assert.ok(
    source.includes("未测量") && source.includes("不可达"),
    "输出须显式区分「未测量」与「不可达」两种读数",
  );
  assert.ok(
    source.includes("INJECTION_EXCLUDED_TYPES"),
    "排除类型须取自实现常量，不得在本脚本内硬编码",
  );
});


test("预算必须统一：不同 budgetBytes 会把假损失算成真损失", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("PROBE_BUDGET_BYTES"), "探针预算须是单一具名常量");
  const bare = /budgetBytes:\s*\d{4,}/g;
  const hits = [...source.matchAll(bare)].map((m) => m[0]);
  assert.deepEqual(
    hits.filter((x) => !x.includes("10240")),
    [],
    `除配对消融的 10240 外，探针预算必须走常量；发现：${hits.join(", ")}`,
  );
});
