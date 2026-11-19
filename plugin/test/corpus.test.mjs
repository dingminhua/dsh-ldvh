import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { missingCorpus, repoRoot, withTemp } from "./helpers.mjs";

function gitUsable() {
	try {
		execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

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

	if (trackedCount("ldvh-base") === 0) {
		t.skip("本条线不承载事实源（ldvh-base 未被跟踪）——发布线的缺失是设计如此");
		return;
	}

	assert.ok(
		trackedCount("ldvh-base") >= 10,
		`ldvh-base 只剩 ${trackedCount("ldvh-base")} 个跟踪文件。事实源不可能这么小——` +
			`这通常意味着目录被部分清空或被 .gitignore 吞掉，而剩余目录结构与缺失目录名对不上，` +
			`missingCorpus 未必能发现。请核对 git status 与 .gitignore。`,
	);
});

test("missingCorpus 的判定本身必须可靠——不存在与空目录都要报缺", async (t) => {

	const absent = await missingCorpus(join(repoRoot, "__definitely_absent__"));
	assert.deepEqual(
		absent.sort(),
		["ldvh-base", "specs"],
		"根不存在时必须报缺两个目录，不得恒返回空（否则 skip 闸形同虚设）",
	);

	await withTemp("ldvh-corpus-empty-", async (dir) => {
		await mkdir(join(dir, "ldvh-base"), { recursive: true });
		await mkdir(join(dir, "specs"), { recursive: true });
		const empty = await missingCorpus(dir);
		assert.deepEqual(
			empty.sort(),
			["ldvh-base", "specs"],
			"目录存在但无 .md 载体时必须报缺——空目录不能算语料齐备",
		);

		await writeFile(join(dir, "ldvh-base", "goal.md"), "---\nx: 1\n---\n", "utf8");
		await writeFile(join(dir, "specs", "00-x.md"), "---\nx: 1\n---\n", "utf8");
		assert.deepEqual(await missingCorpus(dir), [], "有 .md 载体后必须判为齐备");
	});
});
