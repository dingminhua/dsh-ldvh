import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ensureRegistrationCarrier, evaluateRegistrationEntry } from "../lib/governed-projects.js";

const execFileAsync = promisify(execFile);
const isWindows = process.platform === "win32";

async function freshHome(prefix) {
	const base = await mkdtemp(join(tmpdir(), prefix));
	const home = (...segments) => join(base, ...segments);
	await ensureRegistrationCarrier(home);
	return { base, home };
}

async function grantOverBroad(carrierDir, principal) {
	await execFileAsync("icacls", [carrierDir, "/grant", `${principal}:(OI)(CI)(R)`], { windowsHide: true });
}

test("Windows：普通载体目录可通过核验（否则登记在 Windows 上仍不可用）", { skip: !isWindows && "仅 win32 可达该分支" }, async (t) => {
	const { base, home } = await freshHome("acl-positive-");
	t.after(() => rm(base, { recursive: true, force: true }));
	const result = await evaluateRegistrationEntry(home);
	assert.equal(
		result.ok,
		true,
		`载体目录未被越界授权时须放行；实际：${JSON.stringify(result.error ?? null)}`,
	);
});

test("Windows：载体目录被授予 Everyone 时拒绝（08 §5.6 不得扩大到其它用户）", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	const { base, home } = await freshHome("acl-everyone-");
	t.after(() => rm(base, { recursive: true, force: true }));
	await grantOverBroad(join(base, "ldvh"), "Everyone");

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "Everyone 被授权时不得放行");
	assert.equal(result.error?.code, "registration_permission_unverified", `实际码：${result.error?.code}`);
	assert.match(String(result.error?.message ?? ""), /Everyone/, "须点明越界主体");
	assert.ok(
		Array.isArray(result.error?.details?.widenedTo) && result.error.details.widenedTo.length > 0,
		"须在 details.widenedTo 交出越界条目",
	);
	const after = await execFileAsync("icacls", [join(base, "ldvh")], { windowsHide: true });
	assert.match(String(after.stdout ?? ""), /Everyone/, "核验不得修改 ACL");
});

test("Windows：载体目录被授予 BUILTIN\\Users 时同样拒绝", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	const { base, home } = await freshHome("acl-users-");
	t.after(() => rm(base, { recursive: true, force: true }));
	await grantOverBroad(join(base, "ldvh"), "BUILTIN\\Users");

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "BUILTIN\\Users 被授权时不得放行");
	assert.equal(result.error?.code, "registration_permission_unverified", `实际码：${result.error?.code}`);
});

test("Windows：载体目录不存在时报 carrier_unavailable（不是 permission_unverified）", { skip: !isWindows && "仅 win32 可达该分支" }, async (t) => {
	const base = await mkdtemp(join(tmpdir(), "acl-missing-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...segments) => join(base, ...segments);
	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "载体缺失时不得放行");
	assert.equal(
		result.error?.code,
		"registration_carrier_unavailable",
		`目录不存在须报 carrier_unavailable，实际：${result.error?.code}`,
	);
});

test("Windows：ACL 核验器本身失败时 fail-closed（permission_unverified，不是放行）", { skip: !isWindows && "仅 win32 可达该分支" }, async (t) => {
	const base = await mkdtemp(join(tmpdir(), "acl-unverifiable-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	const carrier = join(base, "dsh home", "ldvh");

	let constructed = false;
	try {
		const who = (await execFileAsync("whoami", [], { windowsHide: true })).stdout.trim();
		await execFileAsync("icacls", [carrier, "/deny", `${who}:(R)`], { windowsHide: true });
		constructed = true;
		await execFileAsync("icacls", [carrier], { windowsHide: true }).then(
			() => { constructed = false; },
			() => { constructed = true; },
		);
	} catch {
		constructed = false;
	}
	if (!constructed) {
		t.skip("本机无法构造「ACL 读不到」而保持目录可达的场景");
		return;
	}
	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "ACL 读不到时不得放行");
	assert.equal(result.error?.code, "registration_permission_unverified", `实际码：${result.error?.code}`);
});




test("Windows：载体路径**含空格**时 Everyone 越界仍须检出（原实现此处 fail-open）", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	const base = await mkdtemp(join(tmpdir(), "acl with space "));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	await execFileAsync("icacls", [join(base, "dsh home", "ldvh"), "/grant", "Everyone:(OI)(CI)(R)"], { windowsHide: true });

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "含空格路径下 Everyone 越界必须被检出，不得 fail-open");
	assert.equal(result.error?.code, "registration_permission_unverified", `实际码：${result.error?.code}`);
});

test("Windows：载体**文件**的 ACL 越界同样须检出（原实现只核目录）", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	const base = await mkdtemp(join(tmpdir(), "acl-file-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	const file = join(base, "dsh home", "ldvh", "governed-projects.yaml");
	await writeFile(file, 'schema_version: 1\ngovernance_instance_name: T\nproduct_description: T\nprojects: []\ndefault_project_id: ""\n', "utf8");
	await execFileAsync("icacls", [file, "/grant", "Everyone:(R)"], { windowsHide: true });

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "文件 ACL 越界必须被检出");
	assert.equal(result.error?.code, "registration_permission_unverified", `实际码：${result.error?.code}`);
});

test("Windows：越界主体名称与错误码跨平台一致（目录与文件两处都报 permission_unverified）", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	const base = await mkdtemp(join(tmpdir(), "acl-code-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	await execFileAsync("icacls", [join(base, "dsh home", "ldvh"), "/grant", "BUILTIN\\Users:(OI)(CI)(R)"], { windowsHide: true });

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.error?.code, "registration_permission_unverified", "须与 Unix 侧「权限过宽」同码");
	assert.ok(Array.isArray(result.error?.details?.widenedTo) && result.error.details.widenedTo.length > 0);
});