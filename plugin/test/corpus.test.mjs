/**
 * 仓库自带语料（`ldvh-base/` + `specs/`）的存在性反向守卫。
 *
 * WHY THIS EXISTS
 * 一批召回/注入用例把**本仓库自己的事实源与规范源**当作被测语料（见
 * `helpers.mjs` 的 `skipWithoutCorpus`）。这类用例在语料缺席时如实 skip——
 * 那是必要的，因为 `main` 是发布线、按 `adr-62d3e2d8` 其树不含事实对象，
 * 从发布线取树跑测试不应被判为代码缺陷。
 *
 * 但只有 skip 没有反向守卫时，会出现一个更坏的处境：**语料被误删也是全绿。**
 * skip 是"我不知道"，不是"没问题"；若无人检查"该在的时候在不在"，那 31 条
 * 断言就从"守护召回质量"退化成"语料在才守护，不在就沉默"。沉默与通过在外观
 * 上无法区分——这正是本文件要消除的。
 *
 * DECISION RULE（为什么判据落在 git，而不是判据落在"有没有 LDVH 角色环境变量"）
 * 反向守卫必须能区分两种"语料不在"：
 *   (a) 合法的：从发布线取树（`main` 及其派生），本来就不带事实对象；
 *   (b) 非法的：开发线上语料被误删、被 `.gitignore` 吞掉、或未被跟踪。
 * 区分二者的依据不能是"当前分支叫什么"——分支名是人为标签，`dev` 上照样
 * 可能有一次把 `ldvh-base/` 删掉的提交。故判据取**版本控制事实**：
 *   - 语料目录**已被跟踪**（`git ls-files` 非空）⇒ 它属于本条线的载体，
 *     此时磁盘上缺失即非法，必须报错；
 *   - 语料目录**从未被跟踪** ⇒ 本条线按设计不承载事实对象（发布线），
 *     缺失合法，跳过。
 * 这条判据在 `dev`（299 个跟踪文件）与 `main`（0 个）上自动给出相反且正确的
 * 结论，无需任何配置、标记文件或分支名判断。
 *
 * 与 `adr-62d3e2d8` 的关系
 * 该 ADR 第 4 项如实登记"本决策不提供任何自动化的分支构造，也没有检查在推送
 * 时拒收带 `ldvh-base/` 的 `main` 提交"。本文件不补那个缺口（它是推送侧
 * 拒收，属另一层）；本文件只保证**开发线上的语料缺失不会被 skip 掩盖**。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { missingCorpus, repoRoot, withTemp } from "./helpers.mjs";

/** git 是否可用且当前目录在仓库内——不可用时跳过，绝不伪造通过。 */
function gitUsable() {
	try {
		execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** 某目录下**已被 git 跟踪**的文件数；git 不可用或目录不存在时返回 0。 */
function trackedCount(relDir) {
	try {
		const raw = execFileSync("git", ["ls-files", "-z", "--", relDir], { cwd: repoRoot, encoding: "utf8" });
		return raw.split("\0").filter(Boolean).length;
	} catch {
		return 0;
	}
}

test("承载语料的线不得丢失语料——缺失即报错，不得由 skip 静默掩盖", async (t) => {
	if (!gitUsable()) {
		t.skip("git 不可用（或不在仓库内），无法判定该线是否承载语料");
		return;
	}

	const corpusDirs = ["ldvh-base", "specs"];
	const tracked = Object.fromEntries(corpusDirs.map((d) => [d, trackedCount(d)]));
	const carriers = corpusDirs.filter((d) => tracked[d] > 0);

	// 发布线（语料从未被跟踪）：缺失合法，本条不适用。
	// 注意这里判的是"该线是否承载语料"，不是"该线叫什么名字"。
	if (carriers.length === 0) {
		t.skip("本条线不承载语料（ldvh-base 与 specs 均未被跟踪）——发布线的缺失是设计如此");
		return;
	}

	const missing = await missingCorpus(repoRoot);
	const wronglyMissing = missing.filter((d) => tracked[d] > 0);

	assert.deepEqual(
		wronglyMissing,
		[],
		`本条线跟踪了 ${carriers.map((d) => `${d}(${tracked[d]} 个文件)`).join("、")}，` +
			`但磁盘上缺失 ${wronglyMissing.join("、")}。这不是"语料不在所以跳过"的合法情形——` +
			`语料属于本条线的载体，缺失会让 ${wronglyMissing.join("、")} 相关的召回/注入用例静默 skip，` +
			`而 skip 与通过在外观上无法区分。请恢复该目录，或（若确要移出事实源）同时修改本用例与 adr-62d3e2d8。`,
	);
});

test("语料计数不得归零——跟踪数骤降同样报错（防止'目录还在但被清空'）", async (t) => {
	if (!gitUsable()) {
		t.skip("git 不可用（或不在仓库内），无法判定跟踪状态");
		return;
	}

	// 只有承载事实源的线才有意义。发布线（`ldvh-base` 从未被跟踪）上"事实源不在"
	// 是设计如此，本条不适用——**不能拿 0 当异常**，否则守卫会在正确的树上变红。
	if (trackedCount("ldvh-base") === 0) {
		t.skip("本条线不承载事实源（ldvh-base 未被跟踪）——发布线的缺失是设计如此");
		return;
	}

	// 下限按"目录仍承载内容"设定，不锁定具体条数——事实对象会持续增删，
	// 锁死条数会让本用例在每次正常写入后变红（那会把真守卫变成噪音）。
	// 判据只回答一个问题：这个目录还是不是一个有内容的语料目录。
	assert.ok(
		trackedCount("ldvh-base") >= 10,
		`ldvh-base 只剩 ${trackedCount("ldvh-base")} 个跟踪文件。事实源不可能这么小——` +
			`这通常意味着目录被部分清空或被 .gitignore 吞掉，而剩余目录结构与缺失目录名对不上，` +
			`missingCorpus 未必能发现。请核对 git status 与 .gitignore。`,
	);
});

test("missingCorpus 的判定本身必须可靠——不存在与空目录都要报缺", async (t) => {
	// 本条只测守卫函数本身，与当前检出在哪条线上无关，故不需要任何 skip 前置。
	// 它是 skip 闸的地基：若 missingCorpus 恒返回空，31 条用例的 skip 永不触发，
	// 发布线上就会红；若它恒返回非空，dev 上 31 条会全部静默跳过——两种失效外观
	// 相反，后果同样是"守卫消失"。

	// (1) 根不存在 ⇒ 两个目录都报缺
	const absent = await missingCorpus(join(repoRoot, "__definitely_absent__"));
	assert.deepEqual(
		absent.sort(),
		["ldvh-base", "specs"],
		"根不存在时必须报缺两个目录，不得恒返回空（否则 skip 闸形同虚设）",
	);

	// (2) 目录存在但**没有任何 .md 载体** ⇒ 同样报缺。
	// 这一条是 missingCorpus 与「目录存在即算齐备」的分水岭：空目录支撑不了任何
	// 「真实语料能召回 X」的断言，判它齐备会让 skip 闸在该触发时不触发。
	await withTemp("ldvh-corpus-empty-", async (dir) => {
		await mkdir(join(dir, "ldvh-base"), { recursive: true });
		await mkdir(join(dir, "specs"), { recursive: true });
		const empty = await missingCorpus(dir);
		assert.deepEqual(
			empty.sort(),
			["ldvh-base", "specs"],
			"目录存在但无 .md 载体时必须报缺——空目录不能算语料齐备",
		);

		// (3) 补入 .md 载体后转为齐备（正向对照，证明 (2) 判的不是"目录名"而是内容）
		await writeFile(join(dir, "ldvh-base", "goal.md"), "---\nx: 1\n---\n", "utf8");
		await writeFile(join(dir, "specs", "00-x.md"), "---\nx: 1\n---\n", "utf8");
		assert.deepEqual(await missingCorpus(dir), [], "有 .md 载体后必须判为齐备");
	});
});
