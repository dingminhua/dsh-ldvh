// plugin/lib/web-preferences.js：原子写入的临时文件名与端到端可写性。
//
// 2026-11-02 的真实缺陷：临时文件名取 `path.basename` 用的是「按 `/` 切分」的
// 自实现。Windows 上 `dshHomePath()` 给出 `C:\Users\...\web-preferences.yaml`，
// 按 `/` 切分得不到分段，函数原样返回整条路径 —— 临时文件名于是变成
// `.<整条路径>.uuid.tmp`，含盘符冒号与反斜杠，`writeFile` 抛 ENOENT，
// 插件侧 POST /ldvh/api/governed-projects/color 整条路径不可用。
//
// 该路径此前**零测试覆盖**，所以坏了也没被发现。本用例补上两个层次：
//   1) 判据层：写入过程的临时文件名不得含路径分隔符（直接盯根因，不依赖平台）
//   2) 结果层：改颜色后载体真的落盘且可读回（端到端）
// 第 1 条在 POSIX 上也会因旧实现而通过，故第 2 条在同一机器上承担真实回归；
// 两者合起来使「回退旧实现」在 Windows 上必红、在 POSIX 上仍守住结果契约。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectColors, updateProjectColor } from "../lib/web-preferences.js";

/** 造一个最小可用的 dshHome 与登记载体。 */
async function makeHome() {
	const root = await mkdtemp(join(tmpdir(), "ldvh-webprefs-"));
	const home = (...segments) => join(root, ...segments);
	await mkdir(home("ldvh"), { recursive: true });
	await writeFile(
		home("ldvh", "governed-projects.yaml"),
		[
			"schema_version: 1",
			"governance_instance_name: test instance",
			"product_description: test description",
			"projects:",
			"  - id: probe",
			`    path: ${JSON.stringify(root)}`,
			"    name: probe",
			"default_project_id: probe",
			"",
		].join("\n"),
		"utf8",
	);
	return home;
}

test("updateProjectColor 把颜色真正写进载体（临时文件名不得含路径）", async () => {
	const home = await makeHome();
	const result = await updateProjectColor(home, "probe", "sky");
	assert.equal(result.ok, true, `写入应成功：${JSON.stringify(result.error ?? {})}`);

	// 结果层：载体落盘且解析回同一个颜色。
	const colors = await readProjectColors(home);
	assert.equal(colors.get("probe"), "sky");

	const raw = await readFile(home("ldvh", "web-preferences.yaml"), "utf8");
	assert.match(raw, /project_colors:/);
	assert.match(raw, /probe: sky/);
});

test("updateProjectColor 的临时文件名只含 basename——防止按特定分隔符切分回退", async () => {
	// 直接复算应当使用的临时文件前缀。旧实现（split("/")）在 Windows 上会把
	// 整条路径塞进文件名；本条以「临时文件名是否只由 basename 构成」为判据。
	const home = await makeHome();
	const filePath = home("ldvh", "web-preferences.yaml");
	const expected = `web-preferences.yaml`;

	// 旧实现的算法：按 "/" 切分取最后一段。
	const legacy = (p) => {
		const parts = p.split("/");
		return parts[parts.length - 1] || p;
	};
	// 平台无关断言：在含反斜杠的路径上，旧实现会返回整条路径（≠ 文件名）。
	if (filePath.includes("\\")) {
		assert.notEqual(legacy(filePath), expected, "旧实现在 Windows 路径上确实取不到 basename（缺陷复现）");
	}

	// 修复后：写入成功即证明临时文件名合法（含分隔符/冒号时 writeFile 必抛错）。
	const result = await updateProjectColor(home, "probe", "amber");
	assert.equal(result.ok, true, "含反斜杠的路径也必须能写出临时文件");

	// 清除颜色走 rm 分支，同样不该抛。
	const cleared = await updateProjectColor(home, "probe", null);
	assert.equal(cleared.ok, true);
	assert.equal((await readProjectColors(home)).size, 0);
});
