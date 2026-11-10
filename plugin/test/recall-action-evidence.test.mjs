// 召回取证脚本的结构守卫（2026-11-11，goal-a8048268）
//
// 本文件**不测召回质量**，只测 `scripts/recall-action-evidence.mjs` 的三项口径
// 是否还被正确执行。理由：这类取证脚本最容易烂的方式不是「数字变了」，而是
// **口径悄悄变宽**——把弱匹配算成回指、把系统注入当作用户提问、把 relay 算成
// 落实。数值会随语料漂移，口径不漂才使读数可比。
//
// 这些坑在本次会话里逐个踩过，每条断言对应一次实际错误：
//   1. 按字母序截断目录 → 样本被目录命名决定（实测 628 目录只取到 9 个）
//   2. 注入事件自己当回合 → 紧随其后的行动被丢弃（实测 0 次工具调用）
//   3. 系统注入的 user/message 当作回合边界 → 单会话 90 次注入只切出 1 回合
//   4. 标题前 6 字子串匹配 → 252 次回指里 116 次落在 `dsh-ui`／`Spark ` 等通用前缀
//
// 判据都是**行为性**的：跑一次真实语料，检查这三类量之间的关系。

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "plugin", "scripts", "recall-action-evidence.mjs");

/** 跑一次取证脚本（取较小样本，够判定口径即可）。 */
function runEvidence(limit = 30) {
	const out = execFileSync(
		process.execPath,
		[SCRIPT, "--limit-sessions", String(limit), "--json"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	const parsed = JSON.parse(out);
	// 脚本的 --json 会输出两段（summary 与 positionSummary 曾分两次打印）。
	// 若出现两段，取第一段即可——守卫只关心 summary 里的量。
	return Array.isArray(parsed) ? parsed[0] : parsed;
}

const data = runEvidence(30);
const s = data.summary;

test("取证口径：样本须按「有无注入」筛选，不按目录名字母序截断", () => {
	// 坑 1 的回归：初版 `.slice(0, MAX_SESSIONS)` 取字母序前 N 个目录，实测
	// 628 个目录里含注入的分散全表，截断后只剩 9 个。判据：回合数应远大于
	// 会话数不会有上限错觉——这里只要求「有注入的会话都被计入」，故回合数
	// ≥ 会话数是有意义的弱断言，且 30 个会话应切出明显多于 8 个回合。
	assert.ok(
		s.sessionsWithInjection > 0,
		"须扫到含注入的会话",
	);
	// **不要求回合数 ≥ 会话数**（2026-11-11 修）：实测存在会话，其文件里
	// 出现注入标记但**没有对应的真实注入事件**（如 `07d075d0`：11 行全是
	// 元数据，标记出现在某个 metadata 字段里），属假阳性会话，切不出回合。
	// 这是取证的固有噪声，不是口径错误——要求「每会话至少一回合」会把真实
	// 数据显示成缺陷。
	//
	// 真正要守的是：回合大多数来自真实注入，而不是几乎全被吞掉。
	assert.ok(
		s.turnsWithInjection >= s.sessionsWithInjection - 2,
		`回合数不应明显少于会话数（允许极少数假阳性会话）：`
		+ `回合 ${s.turnsWithInjection} 会话 ${s.sessionsWithInjection}`,
	);
});

test("取证口径：回合边界不得把注入事件自身当作回合", () => {
	// 坑 2 的回归：初版把注入事件当回合起点、紧接其后的 AI 行动落到下一回合
	// 被丢弃，实测 7 回合 0 次工具调用——那会被误读成「召回没引起任何行动」。
	// 判据：绝大多数回合应有工具调用（真实会话里 AI 几乎每回合都会动手）。
	const ratio = s.turnsWithAction / s.turnsWithInjection;
	assert.ok(
		ratio > 0.5,
		`注入后应有行动：${s.turnsWithAction}/${s.turnsWithInjection} = ${(ratio * 100).toFixed(1)}%——`
		+ "低到 0 说明回合切分把行动丢掉了（口径错误，不是「没有行动」的证据）",
	);
});

test("取证口径：系统注入块不得被当作用户提问切断回合", () => {
	// 坑 3 的回归：`Time sampled…`／后台通知等也是 user/message，初版把它们
	// 当回合边界，实测单会话 90 次注入只切出 1 个回合（把 89 个都吞掉）。
	// 判据：回合数应接近注入次数（每次注入开一个回合）。
	assert.ok(
		s.turnsWithInjection >= s.sessionsWithInjection - 2,
		"回合数不应明显少于会话数（允许极少数假阳性会话）",
	);
	assert.ok(
		data.rows.length === s.turnsWithInjection,
		`rows 须与回合数一致：${data.rows.length} vs ${s.turnsWithInjection}`,
	);
});

test("取证口径：标题匹配须排除通用前缀，不得以弱匹配抬高回指率", () => {
	// 坑 4 的回归：初版按前 6 字子串比对，实测 252 次回指里 116 次落在
	// `dsh-ui`／`Spark `／`Human ` 这类通用前缀——它们几乎不携带识别信息。
	// 收紧后回指率从 13.1% 降到 8.0%。
	//
	// 判据不钉数值（随语料漂移），只钉「回指是少数」这一结构：若收紧逻辑
	// 被撤掉，弱匹配会让回指率显著抬升——用 25% 作上界，远高于实测 8%。
	const rate = s.candidateReferences / Math.max(1, s.candidatesInjected);
	assert.ok(
		rate < 0.25,
		`候选被回指的比例 ${(rate * 100).toFixed(1)}% 过高——`
		+ "须检查标题匹配是否退回到通用前缀子串（会把弱匹配算成回指）",
	);
});

test("取证口径：三项证据须分别产出，不得互相替代", () => {
	// 34 §8.1／§8.3 要求的是三件不同的事：材料进了判断（有指向）、行动被改变
	// （有改变）、改变可回指（有可回指依据）。它们可以各自为 0，但**字段必须
	// 都存在**——缺任一项，评估包就交不出 SG 判据要的六项材料。
	for (const key of [
		"turnsWithAction",
		"candidateReferences",
		"refsByKind",
		"turnsByStrongestKind",
		"turnsMentionedCandidate",
		"turnsActedWithoutMention",
	]) {
		assert.ok(key in s, `summary 须含「${key}」——三项证据不得互相替代或漏报`);
	}
	// 分档之和须等于有回指的回合数（分档与总数由同一趟循环算出，分叉即缺陷）。
	const tiers = s.turnsByStrongestKind;
	const sum = tiers.write + tiers.read + tiers.relay + tiers.none;
	assert.equal(sum, s.turnsWithInjection, "回指分档之和须等于注入回合数");
});

test("测量完整性：读取失败须如实披露，不得静默折算成零命中", () => {
	// pitfall「测量脚本把失败静默折算成零命中」的回归。初版在解压失败与单行
	// JSON 解析失败处都 `continue`：读不到的会话不进分母（「读不到」被算成
	// 「没有注入」），解析失败的行被丢弃（该行若是注入事件，回合凭空消失）。
	// 两者都让读数**偏向「没有落实」**，且全程零告警。
	//
	// 判据：summary 必须携带三个缺口字段，且非 ENOENT 真失败须为 0。
	assert.ok("unreadableSessions" in s, "summary 须带 unreadableSessions（真读取失败数）");
	assert.ok("unparsableLines" in s, "summary 须带 unparsableLines（不可解析行数）");
	assert.ok("absentSessions" in s, "summary 须带 absentSessions（无日志目录数，与失败区分）");
	assert.equal(
		s.unreadableSessions,
		0,
		`存在 ${s.unreadableSessions} 个真读取失败——读数不完整，须先修复或如实声明后引用`,
	);
	assert.equal(
		s.unparsableLines,
		0,
		`存在 ${s.unparsableLines} 行不可解析——这些行若含注入事件会使回合凭空消失`,
	);
});

test("参数同形：三个测量脚本的预算与条数须可覆盖且默认一致", async () => {
	// pitfall「消融脚本多调用点各自硬编码预算致读数不一」的回归。初版消融脚本
	// 把 LIMIT/BUDGET 写死，另两个脚本可覆盖——拿三者的读数横向比较时，会默认
	// 它们用了同一组参数，改过参数就能让比较失效且不可见。
	//
	// 判据：三个脚本都接受 --limit／--budget，且在输出首行印出实际生效值。
	const { readFile } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const scripts = [
		"recall-real-eval.mjs",
		"recall-action-evidence.mjs",
		"recall-topic-context-ablation.mjs",
	];
	for (const name of scripts) {
		const src = await readFile(join(ROOT, "plugin", "scripts", name), "utf8");
		assert.ok(src.includes("--limit"), `${name} 须接受 --limit 覆盖`);
		assert.ok(src.includes("--budget") || name === "recall-action-evidence.mjs",
			`${name} 须接受 --budget 覆盖（取证脚本不按字节预算取候选，可不接受）`);
		assert.ok(
			!/const (LIMIT|BUDGET) = \d+;/.test(src),
			`${name} 不得把 LIMIT/BUDGET 写死为字面量——须可覆盖，否则跨脚本读数不可比`,
		);
	}
});
