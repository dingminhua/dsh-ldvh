
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(ROOT, "plugin", "scripts", "recall-action-evidence.mjs");

function runEvidence(limit = 30) {
	const out = execFileSync(
		process.execPath,
		[SCRIPT, "--limit-sessions", String(limit), "--json"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	const parsed = JSON.parse(out);
	return Array.isArray(parsed) ? parsed[0] : parsed;
}

const data = runEvidence(30);
const s = data.summary;
const dataTest = s.sessionsWithInjection ? test : test.skip;

dataTest("取证口径：样本须按「有无注入」筛选，不按目录名字母序截断", () => {
	assert.ok(
		s.sessionsWithInjection > 0,
		"须扫到含注入的会话",
	);
	assert.ok(
		s.turnsWithInjection >= s.sessionsWithInjection - 2,
		`回合数不应明显少于会话数（允许极少数假阳性会话）：`
		+ `回合 ${s.turnsWithInjection} 会话 ${s.sessionsWithInjection}`,
	);
});

dataTest("取证口径：回合边界不得把注入事件自身当作回合", () => {
	const ratio = s.turnsWithAction / s.turnsWithInjection;
	assert.ok(
		ratio > 0.5,
		`注入后应有行动：${s.turnsWithAction}/${s.turnsWithInjection} = ${(ratio * 100).toFixed(1)}%——`
		+ "低到 0 说明回合切分把行动丢掉了（口径错误，不是「没有行动」的证据）",
	);
});

dataTest("取证口径：系统注入块不得被当作用户提问切断回合", () => {
	assert.ok(
		s.turnsWithInjection >= s.sessionsWithInjection - 2,
		"回合数不应明显少于会话数（允许极少数假阳性会话）",
	);
	assert.ok(
		data.rows.length === s.turnsWithInjection,
		`rows 须与回合数一致：${data.rows.length} vs ${s.turnsWithInjection}`,
	);
});

dataTest("取证口径：标题匹配须排除通用前缀，不得以弱匹配抬高回指率", () => {
	const rate = s.candidateReferences / Math.max(1, s.candidatesInjected);
	assert.ok(
		rate < 0.25,
		`候选被回指的比例 ${(rate * 100).toFixed(1)}% 过高——`
		+ "须检查标题匹配是否退回到通用前缀子串（会把弱匹配算成回指）",
	);
});

dataTest("取证口径：三项证据须分别产出，不得互相替代", () => {
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
	const tiers = s.turnsByStrongestKind;
	const sum = tiers.write + tiers.read + tiers.relay + tiers.none;
	assert.equal(sum, s.turnsWithInjection, "回指分档之和须等于注入回合数");
});

dataTest("测量完整性：读取失败须如实披露，不得静默折算成零命中", () => {
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
