
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SPEC_07 = join(repoRoot, "specs", "07-Web 呈现与交互规范.md");
const SPEC_06 = join(repoRoot, "specs", "06-Code 实践与测试规范.md");

const TOLERATED_SECTIONS = [
	"### 5.6 本文只承载要求，不承载实现状态",
	"### 5.5 呈现契约的归属",
];
const STATE_EXCLUSIONS = ["不登记实现接线", "「已废弃」", "不承载实现状态", "状态如何表达", "「已删除」"];

function selfLimitingSection(text) {
	const spans = [];
	for (const heading of TOLERATED_SECTIONS) {
		const start = text.indexOf(heading);
		if (start === -1) continue;
		const rest = text.slice(start);
		const endRel = rest.slice(heading.length).search(/\n#{2,3} /);
		const end = endRel === -1 ? text.length : start + heading.length + endRel;
		spans.push([start, end]);
	}
	return spans;
}

const STATE_PATTERNS = [
	"已落地",
	"未落地",
	"已对齐",
	"未对齐",
	"实现状态",
	"实现落点",
	"实现接线",
	"尚未接线",
	"未接线",
	"尚未实现",
	"已实现",
	"形态来源是",
	"本规范不声称该批注释",
	"本节此前登记过",
	"已删除",
	"已废弃",
];

const ARTIFACT_PATTERNS = [
	/\bplugin\/(?:web|lib)\/[^\s，。）`]*\.(?:tsx|ts|js)\b/g,
	/\b[A-Za-z][A-Za-z0-9]*\.(?:tsx|ts|js)\b/g,
	/\b[A-Z][A-Z0-9_]{4,}_CLASS\b/g,
	/@\/[a-z]+\/[A-Za-z]+/g,
	/\btests?\/api\/[a-z-]+\.test\.ts\b/g,
];

function countMatches(text, patterns, { toleratedSpans = [] } = {}) {
	const hits = [];
	let total = 0;
	const inTolerated = (idx, len) =>
		toleratedSpans.some(([s, e]) => idx >= s && idx + len <= e);
	for (const p of patterns) {
		if (typeof p === "string") {
			let idx = text.indexOf(p);
			while (idx !== -1) {
				const window = text.slice(Math.max(0, idx - 12), idx + p.length + 12);
				const excused =
					STATE_EXCLUSIONS.some((ex) => window.includes(ex)) || inTolerated(idx, p.length);
				if (!excused) {
					total += 1;
					hits.push(p);
				}
				idx = text.indexOf(p, idx + p.length);
			}
		} else {
			const m = text.match(p);
			if (m) {
				for (const hit of m) {
					const idx = text.indexOf(hit);
					if (!inTolerated(idx, hit.length)) {
						total += 1;
						hits.push(hit);
					}
				}
			}
		}
	}
	return { total, hits };
}

const STATE_BUDGET_07 = 0;
const ARTIFACT_BUDGET_07 = 0;

const ARTIFACT_BUDGET_06 = 9;

test("S1: specs/07 正文的状态陈述数不得超过阈值（对齐 06 的实测值 0）", async () => {
	const text = await readFile(SPEC_07, "utf8");
	const toleratedSpans = selfLimitingSection(text);
	const { total, hits } = countMatches(text, STATE_PATTERNS, { toleratedSpans });
	const uniq = [...new Set(hits)];
	assert.equal(
		total,
		STATE_BUDGET_07,
		`specs/07 含 ${total} 处状态陈述（阈值 ${STATE_BUDGET_07}），命中：${JSON.stringify(uniq)}\n` +
			`依据 specs/01 §7.2：规范正文只承载要求，不得承载「当前如何」的事实陈述。\n` +
			`处置：把「随实现变化即需改写」的内容移入 plugin/web/docs/（下位设计文档），` +
			`规范正文只保留现状变化后仍成立的要求或条件式要求。\n` +
			`（§3.4 自限条款内命名被禁类别与去向的表述已豁免，其余位置不豁免。）`,
	);
});

test("S2: specs/07 正文的实现物引用数不得超过阈值", async () => {
	const text = await readFile(SPEC_07, "utf8");
	const toleratedSpans = selfLimitingSection(text);
	const { total, hits } = countMatches(text, ARTIFACT_PATTERNS, { toleratedSpans });
	const uniq = [...new Set(hits)];
	assert.ok(
		total <= ARTIFACT_BUDGET_07,
		`specs/07 含 ${total} 处实现物引用（阈值 ${ARTIFACT_BUDGET_07}），命中：${JSON.stringify(uniq)}\n` +
			`依据 specs/01 §7.2 第 1 项：正文不得承载实现所在的文件、函数或批次说明。\n` +
			`处置：组件名/常量名/测试路径归 plugin/web/docs/；规范只保留可验收的呈现语义。\n` +
			`（§3.4 自限条款内指明去向的表述已豁免，其余位置不豁免。）`,
	);
});

test("S1 基线：specs/06 的状态陈述为 0（本守卫阈值的来源）", async () => {
	const text = await readFile(SPEC_06, "utf8");
	const { total, hits } = countMatches(text, STATE_PATTERNS);
	const uniq = [...new Set(hits)];
	assert.equal(
		total,
		0,
		`specs/06（本守卫的模板基线）应保持零状态陈述，实际 ${total} 处：${JSON.stringify(uniq)}。\n` +
			`若 06 自身出现状态陈述，说明阈值来源已漂移，须先复核 S1 的阈值设定。`,
	);
});

test("S2 基线：specs/06 的实现物引用属「结构约定」且不伴随状态陈述（模板的合法范例）", async () => {
	const text = await readFile(SPEC_06, "utf8");
	const { total } = countMatches(text, ARTIFACT_PATTERNS);
	assert.ok(
		total <= ARTIFACT_BUDGET_06,
		`specs/06（模板）的实现物引用应 ≤ ${ARTIFACT_BUDGET_06}，实际 ${total}。\n` +
			`若 06 的实现物引用超出其「目录结构」条的范围，说明模板性质已变，须复核 S2 的口径。`,
	);
	const state = countMatches(text, STATE_PATTERNS);
	assert.equal(
		state.total,
		0,
		`specs/06 的实现物引用不得伴随状态陈述（模板性质）；实际状态陈述 ${state.total} 处。`,
	);
});
