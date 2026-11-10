// Tests for the Windows ACL verifier behind `evaluateRegistrationEntry` (08 §5.6).
//
// 背景（2026-11-10）：该函数在 win32 上原为**无条件** `permission_unverified`，
// 理由是「本实现没有 ACL 核验器」。该前提不成立——`icacls` 随系统提供、可稳定
// 读取 DACL。无条件 fail-closed 的后果是 CLI 登记入口在 Windows 上永久不可用，
// 而 08 §5.6 明文预期 Windows 可写（「Windows 目标文件占用导致 replace 失败时
// 明确返回失败」）。
//
// 本文件守两件事，缺一即失败：
//   ① **正向**：普通 DSH home 的载体目录可被核验并通过——否则 Windows 上登记
//      仍然不可用，等于没修；
//   ② **负向**：被授予 Everyone / BUILTIN\Users 的载体目录必须被拒——否则
//      「核验」是空转，08 §5.6「不得扩大到其它用户」失去机械保障。
//
// 负向用例依赖 `icacls /grant`，仅在 Windows 上可构造；非 Windows 平台整文件
// 跳过（该分支本身也只在 win32 可达）。
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

/** 建一个独立的临时 DSH home，并让载体目录就位。 */
async function freshHome(prefix) {
	const base = await mkdtemp(join(tmpdir(), prefix));
	const home = (...segments) => join(base, ...segments);
	await ensureRegistrationCarrier(home);
	return { base, home };
}

/** 给载体目录加一条越界授权（仅 Windows 可用）。 */
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
	// 必须指出**是谁**越界，否则调用方无从修复。
	assert.match(String(result.error?.message ?? ""), /Everyone/, "须点明越界主体");
	assert.ok(
		Array.isArray(result.error?.details?.widenedTo) && result.error.details.widenedTo.length > 0,
		"须在 details.widenedTo 交出越界条目",
	);
	// 本实现不得「顺手修好」ACL——那会把 Human 的配置悄悄改掉。
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
	// 独立审核指出：本用例原写成析取（carrier_unavailable || permission_unverified），
	// 而缺目录时实际只会返回前者，故「核验器无从判断」那一支从未被覆盖。
	// 这里改成精确断言，把「目录不存在」与「ACL 读不到」两个分支分开。
	const base = await mkdtemp(join(tmpdir(), "acl-missing-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...segments) => join(base, ...segments);
	// 不调用 ensureRegistrationCarrier：载体目录不存在。
	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.ok, false, "载体缺失时不得放行");
	assert.equal(
		result.error?.code,
		"registration_carrier_unavailable",
		`目录不存在须报 carrier_unavailable，实际：${result.error?.code}`,
	);
});

test("Windows：ACL 核验器本身失败时 fail-closed（permission_unverified，不是放行）", { skip: !isWindows && "仅 win32 可达该分支" }, async (t) => {
	// 直接验证「核验读不到 → 不得默认放行」这一支。构造方式：把载体目录换成
	// **一个符号链接指向不存在的目标**，使 Get-Acl 失败而 stat 仍能看到目录项。
	// 若平台不允许该构造，则跳过并说明（不静默通过）。
	const base = await mkdtemp(join(tmpdir(), "acl-unverifiable-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	const carrier = join(base, "dsh home", "ldvh");

	let constructed = false;
	try {
		// 用 icacls 的 /deny 让当前用户失去读取 DACL 所需权限（不改目录内容）。
		const who = (await execFileAsync("whoami", [], { windowsHide: true })).stdout.trim();
		await execFileAsync("icacls", [carrier, "/deny", `${who}:(R)`], { windowsHide: true });
		constructed = true;
		await execFileAsync("icacls", [carrier], { windowsHide: true }).then(
			() => { constructed = false; }, // 仍能读 → 构造不成立
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



// ---------------------------------------------------------------------------
// 独立审核实测出的四类漏检（2026-11-10 修订后重写的判据）
// ---------------------------------------------------------------------------

test("Windows：载体路径**含空格**时 Everyone 越界仍须检出（原实现此处 fail-open）", { skip: !isWindows && "仅 win32 可构造" }, async (t) => {
	// 独立审核实测：上一版按空白剥离 icacls 首行前缀，路径含空格即被截错，
	// 主体读成「b\ldvh Everyone」→ 越界漏检 → **放行**（fail-open）。
	// DSH 用户配置根在 C:\Users\<用户名>\AppData\Roaming，用户名含空格即触发。
	// 本用例把载体放在含空格的目录里，断言不得放行。
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
	// 独立审核发现：win32 分支核完目录即 return，「目录 0700 与文件 0600」的文件半边
	// 从未核验（08 §5.6 在 Unix 侧明确要求两者）。本用例只给**文件**授 Everyone。
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
	// 独立审核指出：上一版 Windows 越界报 access_denied，而 Unix 侧同类条件报
	// permission_unverified——同一条件跨平台不同码，调用方按码分支会不一致。
	const base = await mkdtemp(join(tmpdir(), "acl-code-"));
	t.after(() => rm(base, { recursive: true, force: true }));
	const home = (...s) => join(base, "dsh home", ...s);
	await ensureRegistrationCarrier(home);
	await execFileAsync("icacls", [join(base, "dsh home", "ldvh"), "/grant", "BUILTIN\\Users:(OI)(CI)(R)"], { windowsHide: true });

	const result = await evaluateRegistrationEntry(home);
	assert.equal(result.error?.code, "registration_permission_unverified", "须与 Unix 侧「权限过宽」同码");
	// 须交出越界条目，调用方才知该改哪一条
	assert.ok(Array.isArray(result.error?.details?.widenedTo) && result.error.details.widenedTo.length > 0);
});