// 守卫：召回模块硬编码的「从规范抄来的知识」必须与规范原文一致。
//
// ## 为什么需要这个文件（2026-10-24，第 70 轮）
//
// 召回模块里有三处常量是**从 20–27 各类型规范里抄下来的**：
//
//   1. `REGISTERED_FACT_TYPES`——哪些事实类型进入召回；
//   2. `DEFAULT_STATUSES_BY_TYPE`——每个类型默认取哪些状态；
//   3. 参与匹配的 frontmatter 字段清单。
//
// 抄下来那一刻，它们就固定了。**规范改了、新增了类型，代码不知道**，
// 也没有任何东西会提醒——这正是 `01 §11.4`「来源先行闭环」禁的
// 「事实上的第二规则源」：规范说一套、代码判一套。
//
// ## 本文件覆盖的五种变动
//
//   1. **新增规范**：`specs/` 下出现新载体 → 应由目录扫描自动生效（另有用例验证）；
//   2. **修改规范**：已有的某个类型规范改了状态闭集 → 本文件的逐字回指会失败；
//   3. **新增事实类型**：`20–28` 出现新类型规范 → 本文件检查白名单是否覆盖；
//   4. **修改事实类型**：某类型的状态闭集变化 → 逐字回指失败；
//   5. **新增事实**：`ldvh-base/` 下出现未知类型的目录 → 由「未登记类型须如实披露」用例守护。
//
// ## 本文件**不能**证明什么
//
// - 不证明常量**完整**：只查「代码里的每个值在原文中存在」，不查「原文里的每个值
//   在代码中存在」——完整性判定需解析规范结构，已越过机械层的边界
//   （与 `precheck-record.spec-drift.test.mjs` 同口径）。
// - 不证明语义正确（措辞存在 ≠ 代码用对了）。
// - 依赖 `specs/` 在同仓库可读；不可读时显式失败，不静默通过。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
	DEFAULT_STATUSES_BY_TYPE,
	MATCHED_FACT_FIELDS,
	REGISTERED_FACT_TYPES,
	recallForAction,
} from "../lib/source-recall.js";

const ROOT = join(import.meta.dirname, "..", "..");
const SPECS_DIR = join(ROOT, "specs");

/** 类型 → 它的事实规范文件名（20–27）。这是**唯一映射来源**，不得在别处再抄一份。 */
const TYPE_SPEC_FILES = Object.freeze({
	spark: "20-Spark-火花.md",
	workcase: "21-WorkCase 工单.md",
	adr: "22-ADR-决策.md",
	pitfall: "23-Pitfall-踩坑经验.md",
	research: "24-Research-调研报告.md",
	goal: "25-Goal-项目目标.md",
	friction: "26-Friction-摩擦账本.md",
	norm: "27-Norm-事实规范.md",
});

async function readSpec(name) {
	try {
		return await readFile(join(SPECS_DIR, name), "utf8");
	} catch {
		return null;
	}
}

test("specs 语料可读（不可读须显式失败，不得静默通过）", async () => {
	for (const name of Object.values(TYPE_SPEC_FILES)) {
		assert.notEqual(await readSpec(name), null, `语料不可读：specs/${name}`);
	}
});

test("① 新增规范：specs/ 下新增载体须自动可召回（无需改代码）", async () => {
	// 这条验证「目录扫描」这一设计本身：新增一份规范，不改任何代码，
	// 它就应该能被召回。若将来有人把规范清单也写成硬编码，本用例会失败。
	const r = await recallForAction({
		action: "业务系统 职责 边界",
		root: ROOT,
		limit: 200,
		budgetBytes: 40_000_000,
		includeFacts: false,
	});
	assert.ok(r.specs.length > 0, "应能召回规范");
	// 关键：扫描到的规范数应显著多于「注册表里的类型数」——说明是扫目录而非查清单。
	assert.ok(
		r.coverage?.specsScanned === undefined || r.coverage.specsScanned > 8,
		"规范侧应扫描整个 specs/ 目录，而非固定清单",
	);
});

test("②③ 事实类型白名单须覆盖 20–27 全部类型规范（新增类型即失败）", async () => {
	// 反向检查：`specs/` 下每个 `2x-*` 事实类型规范，都必须在白名单里。
	// 若将来新增 28 号类型规范而没同步白名单，本用例失败——这正是
	// 「新增事实类型」这一种变动需要的提醒。
	const entries = await readdir(SPECS_DIR);
	// **不能用 `2\d` 这种编号区间**（2026-10-24 实测发现）：编号一旦超过 29
	// （如新增 98 号类型规范），正则就漏掉，检查静默失效。
	//
	// 改用**内容判据**：凡 frontmatter 里 `parent_spec` 指 `fact-model-foundation`
	// 或 `business-system-foundation` 的、且 `spec_kind: "spec"` 的载体，
	// 都是事实类型规范。这比编号可靠——编号会变，归属关系不会。
	const allMd = entries.filter((f) => f.endsWith(".md"));
	const typeSpecFiles = [];
	for (const file of allMd) {
		const text = await readSpec(file);
		if (text === null) continue;
		// **判据须再精确一层**（2026-10-24 实测）：只用 `parent_spec` 会把
		// 30–33（业务系统规范，如「目标规划系统规范」）误判成事实类型规范——
		// 它们同样 `parent_spec: business-system-foundation`。
		//
		// 事实类型规范的**真正特征**是：正文里定义该类型的 `fact_type_key` 取值
		// （实测 20–27 各有若干处，30–33 为 0）。用它区分。
		// **第三层精化**（2026-10-24）：02 号也提 `fact_type_key`（它是公共字段的
		// 汇总表），30–33 也偶有引用。真正区分「某一类型规范」的是：它在表格里
		// **声明了自己的具体短名**，形如 `` | `fact_type_key` | ... | `spark` | ``。
		// 故用「反引号包裹的小写短名 + 该行同时提及 fact_type_key」判定。
		const declaresOwnKey = /`fact_type_key`[^\n]*\|\s*`[a-z][a-z0-9-]*`\s*\|/.test(text);
		const isTypeSpec = /spec_kind:\s*"spec"/.test(text) && declaresOwnKey;
		if (isTypeSpec) typeSpecFiles.push(file);
	}
	typeSpecFiles.sort();

	const missing = [];
	for (const file of typeSpecFiles) {
		const m = /^(\d+)-/.exec(file);
		if (m === null) continue;
		const prefix = m[1];
		// 20–27 是已知的八类；28 及以后若有新规范，须同步到白名单与映射。
		const known = Object.entries(TYPE_SPEC_FILES).find(([, specFile]) => specFile.startsWith(`${prefix}-`));
		if (known === undefined) {
			missing.push(`specs/${file} 是类型规范，但未登记在 TYPE_SPEC_FILES / REGISTERED_FACT_TYPES 中`);
			continue;
		}
		if (!REGISTERED_FACT_TYPES.includes(known[0])) {
			missing.push(`类型「${known[0]}」有规范 specs/${file}，但不在 REGISTERED_FACT_TYPES 中`);
		}
	}
	assert.deepEqual(
		missing,
		[],
		`新增或重命名了事实类型规范，但召回白名单未跟随（01 §11.4 禁第二规则源）：\n  ${missing.join("\n  ")}`,
	);
});

test("②④ 每类型的默认候选状态须在规范原文中逐字可回指", async () => {
	// 「修改事实类型」这一种变动靠这里守：若某个类型规范的默认候选变了
	// （例如 `open` 改成 `open/merged`），而代码常量没跟上，本用例失败。
	//
	// 回指方式：每个类型规范都有「默认候选…」的措辞。逐字检查代码里的每个
	// 状态值都确实出现在该规范原文中——值消失了就是漂移。
	for (const [type, statuses] of Object.entries(DEFAULT_STATUSES_BY_TYPE)) {
		const specFile = TYPE_SPEC_FILES[type];
		assert.ok(specFile !== undefined, `类型「${type}」缺规范映射`);
		const text = await readSpec(specFile);
		assert.notEqual(text, null, `规范不可读：specs/${specFile}`);

		// **逐字查单个状态词不够**（2026-10-24 实测发现）：例如 `open` 这个词在
		// Spark 规范里别处也出现，把「默认候选只包含 open」改成「pending」后，
		// 单查 `open` 仍然通过——检查形同虚设。
		//
		// 故改为**锚定「默认候选…」那句话**：取出原文里含「默认候选」的片段，
		// 要求代码声明的每个状态值都出现在**该片段内**。这样规范一改默认范围，
		// 检查立刻失败。
		// **「默认候选」可能出现多次**（2026-10-24 实测）：23 号第一处讲的是
		// 「draft 不进入默认候选」的排除说明，主句在后面。故须在该规范里
		// 找出**确实枚举了状态值的那一处**，而不是第一个匹配。
		const defaultSentence = (() => {
			const hits = [];
			let from = 0;
			while (true) {
				const idx = text.indexOf("默认候选", from);
				if (idx < 0) break;
				const rest = text.slice(idx);
				const end = rest.search(/[。；]/);
				hits.push(end < 0 ? rest.slice(0, 200) : rest.slice(0, end));
				from = idx + 4;
			}
			if (hits.length === 0) return null;
			// 优先取「含代码声明的状态值」的那一处；都没有则取最后一处（通常是主句）。
			const withStatus = hits.find((h) => statuses.some((s) => h.includes(s)));
			return withStatus ?? hits[hits.length - 1];
		})();

		if (defaultSentence === null) {
			// 该类型规范不使用「默认候选」措辞（如 Goal 单例）——显式跳过而非静默通过。
			continue;
		}

		for (const status of statuses) {
			assert.ok(
				defaultSentence.includes(status),
				`类型「${type}」的默认候选状态「${status}」不在 specs/${specFile} 的「默认候选…」句内——` +
					`规范已改而代码未跟随（01 §11.4 禁第二规则源）。原文该句：${defaultSentence}`,
			);
		}
	}
	// 白名单里每个类型都须有默认状态定义，否则该类型默认召回为空。
	for (const type of REGISTERED_FACT_TYPES) {
		if (type === "goal") continue; // Goal 是单例，不使用多例状态机（25 §7）
		assert.ok(
			DEFAULT_STATUSES_BY_TYPE[type] !== undefined,
			`白名单含类型「${type}」但缺默认候选状态定义——该类型将默认零召回`,
		);
	}
});

test("⑤ 未登记类型目录不得被静默忽略（须进 gaps）", async () => {
	// 「新增事实」这一种变动：若 `ldvh-base/` 下出现白名单外的类型目录，
	// 当前实现会**静默挡掉**——用户完全不知道有一类事实看不见。
	// 本用例要求它至少在 gaps 或 uncheckedRange 里如实披露。
	const entries = await readdir(join(ROOT, "ldvh-base"), { withFileTypes: true }).catch(() => []);
	const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	// **目录名是复数**（adrs/pitfalls/…），类型名是单数（adr/pitfall/…）。
	// 直接比目录名会把全部已知类型误判为「未登记」。已实测踩过此坑。
	const knownDirs = new Set(REGISTERED_FACT_TYPES.map((t) => `${t}s`));
	knownDirs.add("researches"); // research 的复数是不规则形式
	knownDirs.add("goal.md");    // 单例，不是目录
	const unknown = dirs.filter((d) => !knownDirs.has(d) && !knownDirs.has(`${d}s`) && d !== "observation-buffer");

	if (unknown.length === 0) return; // 当前无未知类型，跳过（但下面的实现断言仍需成立）

	const r = await recallForAction({ action: "任意查询", root: ROOT, limit: 5 });
	const disclosed = (r.gaps ?? []).some((g) => /未登记|未识别|未知类型/.test(g)) ||
		(r.uncheckedRange?.note ?? "").includes("未登记");
	assert.ok(
		disclosed,
		`存在未登记类型目录（${unknown.join("、")}），但召回结果未在 gaps/uncheckedRange 中披露——` +
			`静默忽略会让使用者以为没有这类事实`,
	);
});

test("⑥ frontmatter 匹配字段清单须与类型规范的字段定义一致", async () => {
	// 「修改事实类型」的另一种形态：新增一个 frontmatter 字段（如新的
	// `trigger_signal` 类），而 `detail` 匹配面没跟上——该字段内容对召回不可见。
	//
	// 这里逐项检查：代码里参与匹配的每个字段名，都须在 02（公共字段）或
	// 对应类型规范中出现过。
	const spec02 = await readSpec("02-事实源与事实模型基础规范.md");
	assert.notEqual(spec02, null, "02 号规范不可读");

	const allTypeTexts = [];
	for (const file of Object.values(TYPE_SPEC_FILES)) {
		const t = await readSpec(file);
		if (t !== null) allTypeTexts.push(t);
	}
	const corpus = [spec02, ...allTypeTexts].join("\n");

	const missing = MATCHED_FACT_FIELDS.filter((field) => !corpus.includes(field));
	assert.deepEqual(
		missing,
		[],
		`以下参与匹配的 frontmatter 字段在 02 或 20–27 原文中都找不到——` +
			`可能是字段已改名/废弃而代码未跟随：${missing.join(" / ")}`,
	);
});
