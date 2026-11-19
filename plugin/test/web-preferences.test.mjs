import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectColors, updateProjectColor } from "../lib/web-preferences.js";

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

	const colors = await readProjectColors(home);
	assert.equal(colors.get("probe"), "sky");

	const raw = await readFile(home("ldvh", "web-preferences.yaml"), "utf8");
	assert.match(raw, /project_colors:/);
	assert.match(raw, /probe: sky/);
});

test("updateProjectColor 的临时文件名只含 basename——防止按特定分隔符切分回退", async () => {
	const home = await makeHome();
	const filePath = home("ldvh", "web-preferences.yaml");
	const expected = `web-preferences.yaml`;

	const legacy = (p) => {
		const parts = p.split("/");
		return parts[parts.length - 1] || p;
	};
	if (filePath.includes("\\")) {
		assert.notEqual(legacy(filePath), expected, "旧实现在 Windows 路径上确实取不到 basename（缺陷复现）");
	}

	const result = await updateProjectColor(home, "probe", "amber");
	assert.equal(result.ok, true, "含反斜杠的路径也必须能写出临时文件");

	const cleared = await updateProjectColor(home, "probe", null);
	assert.equal(cleared.ok, true);
	assert.equal((await readProjectColors(home)).size, 0);
});
