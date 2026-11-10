// `recall_digest` 消融工具的**自检**（2026-11-10）。
//
// WHY 需要这组用例
// 该工具的价值全在「无 digest 副本真的没有该字段」这一前提上。前提若不成立，
// 它仍会**正常输出一份好看的报告**，结论却是错的——2026-11-10 实测踩中：
// `recall_digest` 位于 frontmatter 最后一行时没有尾随换行，正则 `...\n` 删不掉，
// 副本仍带该字段，于是「独有词项」探针恒为 0（看起来像「该字段毫无独有信息」），
// 而实际有 983 条。这类失败**不会报错**，只会给出反向结论。
//
// 故此处不测「具体数字是多少」（数字随语料变），只测**剥离本身是否彻底**，
// 以及报告是否如实带上它自己的边界声明。

import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "recall-digest-ablation.mjs");
const CORPUS = join(import.meta.dirname, "..", "..", "ldvh-base");

/**
 * 剥离正则的**唯一来源**：直接从脚本里取常量声明，避免本用例与实现各写一份
 * 而悄悄漂移（那会让自检守着一个实现已不使用的规则）。
 */
async function loadStripPattern() {
  const source = await readFile(SCRIPT, "utf8");
  const match = /const STRIP_PATTERN = (\/.*?\/gm);/.exec(source);
  assert.ok(match !== null, "脚本必须导出/声明 STRIP_PATTERN 常量");
  return eval(match[1]);
}

test("剥离正则：frontmatter 末行（无尾随换行）也必须被删掉", async () => {
  const STRIP = await loadStripPattern();
  // 这是实测回归形态：`recall_digest` 是最后一个键，行内容之后直接换行进入 `---`。
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
  // 其余键与正文不得被误删。
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
  // 语料可能缺席（纯净检出、只装了子集）——那时本用例跳过而不是判红。
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
      if (source === stripped) continue;              // 本就没有该字段
      if (/^[ \t]*recall_digest:/m.test(stripped)) survivors.push(path);
    }
    assert.deepEqual(survivors, [], `剥离后仍残留 recall_digest 的载体：${survivors.slice(0, 5).join(", ")}`);
  } finally {
    // 只在确认是本次临时目录时才删；不符时不删也不抛——`finally` 中抛错会掩盖
    // 主体断言的真实失败原因（no-unsafe-finally）。
    if (temp.startsWith(join(tmpdir(), "ldvh-strip-selfcheck-"))) {
      await rm(temp, { recursive: true, force: true });
    } else {
      process.stderr.write(`[warn] 临时目录路径不符预期，拒绝删除：${temp}\n`);
    }
  }
});

test("脚本头如实声明边界：不是真实流量指标，且不覆盖主动查询与 L0 索引", async () => {
  const source = await readFile(SCRIPT, "utf8");
  for (const claim of ["不是真实用户流量", "L0 索引", "主动查询", "命中不等于适用"]) {
    assert.ok(source.includes(claim), `脚本头必须如实声明边界：缺少「${claim}」`);
  }
  // 数字必须与语料指纹绑定，否则不可跨时比较。
  assert.ok(source.includes("corpusFingerprint"), "报告必须带语料指纹");
  // 剥离失败必须 fail-loud，不得静默用未真正移除的语料测量。
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
  // 该模式只证明「并入后仍可命中」，不得声称写入器/规范已支持迁移。
  assert.ok(
    source.includes("不证明写入器/规范已支持该迁移"),
    "必须如实声明该模式不构成迁移已完成",
  );
});

test("探针报告必须按类型给出迁移可行性，而不是只报全局丢失数", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 全局「丢失 N 条」不足以支撑决策：同样丢 10 条，落在 ADR/Pitfall 上可并入
  // trigger_signal 救回，落在 friction/research/spark 上则无路可走。
  assert.ok(source.includes("probeTypeBreakdown"), "必须按类型汇总探针结果");
  assert.ok(source.includes("hasMigrationTarget"), "每个类型须标记是否有可迁入字段");
  assert.ok(
    source.includes("TRIGGER_CAPABLE_TYPES"),
    "可迁入类型的判据须是具名常量（22 §8 / 23 §8 采用 trigger_signal）",
  );
  assert.ok(
    /TRIGGER_CAPABLE_TYPES\s*=\s*new Set\(\[[^\]]*"adr"[^\]]*"pitfall"/s.test(source),
    "可迁入类型当前只有 adr 与 pitfall——其余类型闭集无 trigger_signal",
  );
  // 必须把「无迁移目标」的损失单独算出来并打印，否则读者会把 80 条当成都能救。
  assert.ok(source.includes("无迁移目标"), "报告须显式点出无迁移目标的损失");
});

test("抽样不足以支撑类型结论，故必须提供全量模式", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("--all-probes"), "必须提供 --all-probes 全量模式");
  // 实测教训：120 条抽样只覆盖 3 个类型，而判据恰恰依赖「损失落在哪个类型」。
  assert.ok(
    source.includes("抽样会漏掉类型"),
    "须在代码里写明抽样为何不足，防止后来者把它当等价选项",
  );
});

// ── 2026-11-10 新增：三项把「结论可信度」本身固定在工具里的用例 ────────────

test("断言「失去可达」必须区分信息缺失与匹配机制，否则会指错修复方向", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 实测依据：统一预算后 48 条词面失去可达，全部是「载体里根本不存在该词」，
  // 不是「正文里有但没达到正文层 minHits 门槛」。前者只能迁移文本，后者要改门槛，
  // 处置方向相反；不分类就会得出「加门槛/改门槛」这类错误结论。
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
  // 实测踩中：`lossNature: classifyLostProbes(lost)` 漏 await，报告三个计数
  // 全部打印成 `undefined`，但**进程正常退出、无任何报错**。这类缺陷只能靠
  // 用例守住，人眼扫代码看不出。
  assert.ok(
    /lossNature:\s*await\s+classifyLostProbes\(/.test(source),
    "classifyLostProbes 是 async 函数，赋值给报告字段时必须 await",
  );
});

test("limit 必须被当作判据的一部分，而不是无关参数", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 实测依据：同一语料指纹下 limit 变化会改变「失去可达」条数；
  // 「掉出前 N 位」与「真的查不到」是两件事，跨轮比较不对齐 limit 必然自相矛盾。
  assert.ok(
    source.includes("limit 与 budgetBytes 都是判据的一部分"),
    "脚本头须声明 limit 与预算共同影响结论，防止跨轮拿不同口径的数字互比",
  );
  assert.ok(
    source.includes("掉出前 N 位"),
    "运行输出须提示「不在前 limit 条」不等于「不可召回」",
  );
});

test("对象级可达性与词面级可达性必须分开测量", async () => {
  const source = await readFile(SCRIPT, "utf8");
  assert.ok(source.includes("--object-reachability"), "必须提供对象级可达性模式");
  assert.ok(source.includes("objectsUnreachable"), "报告须给出「整体不可达对象数」");
  // 这两者实测差极大：48 条词面真正失去可达，但整体不可达对象为 0。
  // 混为一谈会把「某条同义说法接不上」误报成「对象失联」。
  assert.ok(
    source.includes("两件事"),
    "代码须写明对象级与词面级是两种损失，不可互相替代",
  );
});

test("被入口类型排除的对象必须记作「未测量」而非「不可达」", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 实测踩中 `pitfall-97d65fb9`：`INJECTION_EXCLUDED_TYPES` 把 spark 构造性排除，
  // 若不摘出来会得到「79 个对象不可达」——而 79 恰等于带 digest 的 Spark 数量，
  // 那是没测到，不是查不到。
  assert.ok(source.includes("notCoveredByEntry"), "报告须单列本入口未覆盖的对象数");
  assert.ok(
    source.includes("pitfall-97d65fb9"),
    "须在代码里指向该踩坑记录，使后来者知道为何要摘出来",
  );
  assert.ok(
    source.includes("未测量") && source.includes("不可达"),
    "输出须显式区分「未测量」与「不可达」两种读数",
  );
  // 排除集必须来自实现常量，不得在脚本里另写一份（会悄悄漂移）。
  assert.ok(
    source.includes("INJECTION_EXCLUDED_TYPES"),
    "排除类型须取自实现常量，不得在本脚本内硬编码",
  );
});


test("预算必须统一：不同 budgetBytes 会把假损失算成真损失", async () => {
  const source = await readFile(SCRIPT, "utf8");
  // 实测踩中：同一批探针在 budgetBytes=20000 下报告 111 条全部不可达（0/111），
  // 在 200000 下只有 48 条真正不可达（48/111）——111 里有 63 条是**预算截断**
  // 造成的假损失。三个探针函数此前各写各的预算，导致跨模式数字自相矛盾。
  assert.ok(source.includes("PROBE_BUDGET_BYTES"), "探针预算须是单一具名常量");
  // 不得再出现散落的裸预算字面量（会让口径悄悄漂移）。
  const bare = /budgetBytes:\s*\d{4,}/g;
  const hits = [...source.matchAll(bare)].map((m) => m[0]);
  assert.deepEqual(
    hits.filter((x) => !x.includes("10240")),
    [],
    `除配对消融的 10240 外，探针预算必须走常量；发现：${hits.join(", ")}`,
  );
  assert.ok(
    source.includes("预算把结果截断了"),
    "须在代码里写明预算会制造假损失，防止后来者把它当成字段无效的证据",
  );
});
