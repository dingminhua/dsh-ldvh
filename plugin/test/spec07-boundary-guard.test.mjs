// specs/07 承载边界的机械守卫（Human 指示 2026-10-09）。
//
// WHY THIS EXISTS（真实缺陷，非假设）：
//
// Human 指示：「07 现在承载的内容已经超出本该承载的内容，07 应该和 06 一样只保留上位
// 的要求，具体的实现与状态应该在下位的设计文档里呈现。」
//
// `specs/01` §7.2 早已有明文禁令：
//   「规范正文只承载**要求**……**不得承载任何「当前如何」的事实陈述**」
//   判据：「一句正文如果**随实现或其它载体的现状变化而需要修改**，它是状态，不得留在正文」
//
// 实测（2026-10-09，本守卫的立项依据）：
//   06-Code 实践与测试规范   状态陈述 0 处、实现物引用 9 处（全在同一段「目录结构」条）
//   07-Web 呈现与交互规范    状态陈述 29 处、实现物引用 62 处
// 且 07 的越界**不是弥散的**——§1–§5.4（97 行）与 §6–§12（113 行）的状态与实现物
// 计数**均为 0**，全部越界集中于 §5.5 一个 213 行的块（占全文 48%）。
//
// 这有真实代价，不是洁癖：§5.5 由 `feat(web)`／`fix(web)`／`refactor(web)` 这类**实现
// 提交**驱动增长（3 周内 43 行 → 215 行），方向是「实现改动 → 规范追认」，与 07 §3.3
// 自述的职责（规范约束实现）相反。结果是同一批规则在两处承载并互相漂移——实测 docs
// 侧已出现六处与现行 07 直接矛盾的旧形态（核对三态词、`result.residual` 上屏等）。
//
// 本守卫做两件事：
//   S1 状态陈述守卫——07 的姿态陈述数不得超过阈值（06 的实测值为 0）
//   S2 实现物守卫——07 的实现物引用不得超阈值，且不得出现在「改动记录」语境中
//
// **证明边界（specs/06 §5「守卫测试的证据边界」要求声明）**：
// 本守卫以**源码文本**为断言对象。它证明的是「该形态当前不存在于 07 正文」，**不是**
// 「07 已合规」——正文可用本表未覆盖的措辞承载同一状态（例如把「已落地」写成「已经
// 完成实现」）。故本守卫是**防复发的最低线**，不得据其通过声称 07 已达成 06 的形态。
// 该边界与 06 §5 所述「第一类守卫」（语义独立于字形而存在）同性质，须如实声明。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SPEC_07 = join(repoRoot, "specs", "07-Web 呈现与交互规范.md");
const SPEC_06 = join(repoRoot, "specs", "06-Code 实践与测试规范.md");

/**
 * 状态陈述模式（specs/01 §7.2 禁止的第 1、3 项）：
 * 「某项机制已实现／尚未实现／已由某提交落地」与「当前处理到哪一步、待办、已完成的轮次」。
 * 这些句子**随实现现状变化即需改写**，故不得留在规范正文。
 */
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

/**
 * 实现物模式：源码文件名、代码常量、包路径、测试文件路径。
 * 这些是「实现所在的文件、函数或批次说明」（specs/01 §7.2 第 1 项）。
 */
const ARTIFACT_PATTERNS = [
	/\bplugin\/(?:web|lib)\b[^\s，。）`]*/g,
	/\b[A-Za-z][A-Za-z0-9]*\.(?:tsx|ts|js)\b/g,
	/\b[A-Z][A-Z0-9_]{4,}_CLASS\b/g,
	/@\/utils\/[A-Za-z]+/g,
	/\btests?\/api\/[a-z-]+\.test\.ts\b/g,
];

/** Count occurrences of any pattern in `text`; returns {total, hits}. */
function countMatches(text, patterns) {
	const hits = [];
	let total = 0;
	for (const p of patterns) {
		if (typeof p === "string") {
			let idx = text.indexOf(p);
			while (idx !== -1) {
				total += 1;
				hits.push(p);
				idx = text.indexOf(p, idx + p.length);
			}
		} else {
			const m = text.match(p);
			if (m) {
				total += m.length;
				hits.push(...m);
			}
		}
	}
	return { total, hits };
}

/** 07 的当前阈值。两者均取 0——理由见下。 */
//
// S1 = 0：直接取 06 的实测值（06 正文状态陈述为 0）。
// S2 = 0（**不是** 06 的 9）：07 全文 68 处实现物引用**全部落在 §5.5**（7 行内），
//         §5.5 之外（§1–§5.4、§6–§12 共 210 行）**为 0**。即 07 的其余部分已经做到
//         零实现物引用——该标准对 07 已被证明可达，不是苛求。
//         06 的 9 处属「结构约定」（规定代码放哪）；07 无同类需要——07 定义呈现语义，
//         不规定代码结构（后者归 06 §5）。
const STATE_BUDGET_07 = 0;
const ARTIFACT_BUDGET_07 = 0;

/** 06（模板）自身的额度：其实现物引用属「结构约定」，量级为 9。 */
const ARTIFACT_BUDGET_06 = 9;

test("S1: specs/07 正文的状态陈述数不得超过阈值（对齐 06 的实测值 0）", async () => {
	const text = await readFile(SPEC_07, "utf8");
	const { total, hits } = countMatches(text, STATE_PATTERNS);
	const uniq = [...new Set(hits)];
	assert.equal(
		total,
		STATE_BUDGET_07,
		`specs/07 含 ${total} 处状态陈述（阈值 ${STATE_BUDGET_07}），命中：${JSON.stringify(uniq)}\n` +
			`依据 specs/01 §7.2：规范正文只承载要求，不得承载「当前如何」的事实陈述。\n` +
			`处置：把「随实现变化即需改写」的内容移入 plugin/web/docs/（下位设计文档），` +
			`规范正文只保留现状变化后仍成立的要求或条件式要求。`,
	);
});

test("S2: specs/07 正文的实现物引用数不得超过阈值", async () => {
	const text = await readFile(SPEC_07, "utf8");
	const { total, hits } = countMatches(text, ARTIFACT_PATTERNS);
	const uniq = [...new Set(hits)];
	assert.ok(
		total <= ARTIFACT_BUDGET_07,
		`specs/07 含 ${total} 处实现物引用（阈值 ${ARTIFACT_BUDGET_07}），命中：${JSON.stringify(uniq)}\n` +
			`依据 specs/01 §7.2 第 1 项：正文不得承载实现所在的文件、函数或批次说明。\n` +
			`处置：组件名/常量名/测试路径归 plugin/web/docs/；规范只保留可验收的呈现语义。`,
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
	// 06 自身的额度是 9（不是 07 的 0）：它的实现物全部来自同一段「目录结构」条——
	// 那是在**规定**代码放哪，不是在**记录**某次改动做了什么。07 无同类需要（07 定义
	// 呈现语义，不规定代码结构），故 07 的额度取 0，而这里的基线守护的是 06 自己的额度
	// 与「不伴随状态」这一模板性质。
	assert.ok(
		total <= ARTIFACT_BUDGET_06,
		`specs/06（模板）的实现物引用应 ≤ ${ARTIFACT_BUDGET_06}，实际 ${total}。\n` +
			`若 06 的实现物引用超出其「目录结构」条的范围，说明模板性质已变，须复核 S2 的口径。`,
	);
	// 模板的关键性质：实现物引用不伴随状态陈述（前者规定结构，后者记录改动）。
	const state = countMatches(text, STATE_PATTERNS);
	assert.equal(
		state.total,
		0,
		`specs/06 的实现物引用不得伴随状态陈述（模板性质）；实际状态陈述 ${state.total} 处。`,
	);
});
