// Tests for the four closure items implemented on 2026-09-12 (see
// docs/audit/closure-10d-round.md §五 items 1, 4, 5, 6):
//
//   item 5  07 §5.3 linked-worktree judgement via the Git common-dir
//   item 4  07 §5.4 AI registration entry + the five unavailable codes
//   item 6  08 §6 host seam consumption (guard / invariants / fs-observed /
//           userQuestions)
//   item 1  01 §9.2 items 8/9/11/12 mechanically checkable sub-parts
//
// Every test uses throwaway temp directories; no test writes outside its own
// temporary area.
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveGovernanceScope } from "../lib/governance-scope.js";
import {
	REGISTRATION_UNAVAILABLE_CODES,
	evaluateRegistrationEntry,
	registerProjectFromEntry,
	resolveGitCommonDir,
} from "../lib/governed-projects.js";
import { createHostSeams, recordJudgementForGuard } from "../lib/host-seams.js";
import { bindMembershipEvidence } from "../lib/membership-evidence.js";
import { makeExecute } from "../lib/ldvh-tools.js";
import { git, initRepo, withTemp } from "./helpers.mjs";

const dshHome = (home) => (...segments) => join(home, ...segments);

/** Minimal ToolExecution-shaped object for guard tests: only `name` + agent cwd. */
const agentAt = (cwd) => ({ session: { header: { cwd } } });

/** Create a well-formed empty v5 carrier at home/ldvh/governed-projects.yaml. */
async function writeCarrier(home, body = null) {
	const dir = join(home, "ldvh");
	await mkdir(dir, { recursive: true });
	await chmod(dir, 0o700);
	const file = join(dir, "governed-projects.yaml");
	await writeFile(file, body ?? [
		"schema_version: 1",
		"governance_instance_name: Test",
		"product_description: Test",
		"projects: []",
		'default_project_id: ""',
		"",
	].join("\n"));
	await chmod(file, 0o600);
	return file;
}

// ---------------------------------------------------------------------------
// item 5 — 07 §5.3 linked worktree via Git common-dir
// ---------------------------------------------------------------------------

test("item5: a linked worktree of a registered project is judged governed (07 §5.3 common-dir)", async () => {
	await withTemp("ldvh-wt.", async (base) => {
		const home = join(base, "home");
		const main = await initRepo(base, { name: "main" });
		await git(main, ["commit", "-qm", "init"]);
		const linked = join(base, "linked");
		await git(main, ["worktree", "add", "-q", linked]);

		// The main and linked worktrees have DIFFERENT toplevels but the SAME
		// common-dir — that equality is what the spec makes the identity test.
		const mainCommon = await resolveGitCommonDir(main);
		const linkedCommon = await resolveGitCommonDir(linked);
		assert.equal(mainCommon, linkedCommon);

		await writeCarrier(home);
		const registered = await registerProjectFromEntry(dshHome(home), { id: "p1", path: main });
		assert.equal(registered.ok, true, JSON.stringify(registered));

		const scope = await resolveGovernanceScope(dshHome(home), linked);
		assert.equal(scope.state, "governed");
		assert.equal(scope.project.id, "p1");
	});
});

test("item5: an unrelated repository is still not_governed (no over-matching)", async () => {
	await withTemp("ldvh-wt-neg.", async (base) => {
		const home = join(base, "home");
		const main = await initRepo(base, { name: "main" });
		await git(main, ["commit", "-qm", "init"]);
		const other = await initRepo(base, { name: "other" });
		await git(other, ["commit", "-qm", "init"]);

		await writeCarrier(home);
		await registerProjectFromEntry(dshHome(home), { id: "p1", path: main });

		const scope = await resolveGovernanceScope(dshHome(home), other);
		assert.equal(scope.state, "not_governed");
	});
});

test("item5: a non-Git directory is not_governed, never unavailable", async () => {
	await withTemp("ldvh-wt-plain.", async (base) => {
		const home = join(base, "home");
		const main = await initRepo(base, { name: "main" });
		await git(main, ["commit", "-qm", "init"]);
		const plain = join(base, "plain");
		await mkdir(plain);

		await writeCarrier(home);
		await registerProjectFromEntry(dshHome(home), { id: "p1", path: main });

		const scope = await resolveGovernanceScope(dshHome(home), plain);
		assert.equal(scope.state, "not_governed");
	});
});

test("item5: containment inside the registered root still short-circuits (no git call needed)", async () => {
	await withTemp("ldvh-wt-inside.", async (base) => {
		const home = join(base, "home");
		const main = await initRepo(base, { name: "main" });
		await git(main, ["commit", "-qm", "init"]);

		await writeCarrier(home);
		await registerProjectFromEntry(dshHome(home), { id: "p1", path: main });

		const scope = await resolveGovernanceScope(dshHome(home), join(main, "sub", "deeper"));
		// `sub/deeper` does not exist; realpath fails → unavailable is correct
		// (07 fail-closed), NOT a guess.
		assert.equal(scope.state, "unavailable");
		const scope2 = await resolveGovernanceScope(dshHome(home), main);
		assert.equal(scope2.state, "governed");
	});
});

// ---------------------------------------------------------------------------
// item 4 — 07 §5.4 AI registration entry + the five error codes
// ---------------------------------------------------------------------------

test("item4: registerProjectFromEntry registers a Git project and reads back", async () => {
	await withTemp("ldvh-entry.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		await writeCarrier(home);

		const result = await registerProjectFromEntry(dshHome(home), { id: "p1", path: repo, name: "Demo" });
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.equal(result.value.changed, true);
		assert.equal(result.value.project.id, "p1");
		assert.equal(typeof result.value.registration.fingerprint, "string");
	});
});

test("item4: a second registration of the same project writes nothing (07 §5.4 step 1)", async () => {
	await withTemp("ldvh-entry-idem.", async (base) => {
		const home = join(base, "home");
		const repo = await initRepo(base, { name: "repo" });
		await git(repo, ["commit", "-qm", "init"]);
		await writeCarrier(home);

		const first = await registerProjectFromEntry(dshHome(home), { id: "p1", path: repo });
		const second = await registerProjectFromEntry(dshHome(home), { id: "p1", path: repo });
		assert.equal(second.ok, true);
		assert.equal(second.value.changed, false);
		assert.equal(second.value.reason, "already_registered");
		// The carrier must not have been rewritten.
		assert.equal(second.value.registration.fingerprint, first.value.registration.fingerprint);
	});
});

// The five codes of 07 §5.4, each reached by a real precondition failure.
test("item4: user_config_root_unavailable when the DSH home resolver is absent", async () => {
	const result = await evaluateRegistrationEntry(null);
	assert.equal(result.ok, false);
	assert.equal(result.unavailable, true);
	assert.equal(result.error.code, REGISTRATION_UNAVAILABLE_CODES.USER_CONFIG_ROOT_UNAVAILABLE);
});

test("item4: registration_carrier_unavailable when the carrier directory is gone", async () => {
	await withTemp("ldvh-entry-carrier.", async (base) => {
		const home = join(base, "home");
		const result = await evaluateRegistrationEntry(dshHome(home));
		assert.equal(result.error.code, REGISTRATION_UNAVAILABLE_CODES.CARRIER_UNAVAILABLE);
	});
});

test("item4: registration_schema_invalid when the carrier violates the v5 schema", async () => {
	await withTemp("ldvh-entry-schema.", async (base) => {
		const home = join(base, "home");
		await writeCarrier(home, "schema_version: 99\n");
		const result = await evaluateRegistrationEntry(dshHome(home));
		assert.equal(result.error.code, REGISTRATION_UNAVAILABLE_CODES.SCHEMA_INVALID);
	});
});

test("item4: registration_permission_unverified when the carrier is wider than 0700 (07 §5.6)", async () => {
	if (process.platform === "win32") return;
	await withTemp("ldvh-entry-perm.", async (base) => {
		const home = join(base, "home");
		await writeCarrier(home);
		await chmod(join(home, "ldvh"), 0o777);
		const result = await evaluateRegistrationEntry(dshHome(home));
		assert.equal(result.error.code, REGISTRATION_UNAVAILABLE_CODES.PERMISSION_UNVERIFIED);
	});
});

test("item4: registration_access_denied when the carrier directory is not writable", async () => {
	if (process.platform === "win32") return;
	if (typeof process.getuid === "function" && process.getuid() === 0) return; // root bypasses mode bits
	await withTemp("ldvh-entry-deny.", async (base) => {
		const home = join(base, "home");
		await writeCarrier(home);
		await chmod(join(home, "ldvh"), 0o500);
		try {
			const result = await evaluateRegistrationEntry(dshHome(home));
			assert.equal(result.error.code, REGISTRATION_UNAVAILABLE_CODES.ACCESS_DENIED);
		} finally {
			await chmod(join(home, "ldvh"), 0o700);
		}
	});
});

test("item4: the entry refuses a non-Git directory (07 §5.5)", async () => {
	await withTemp("ldvh-entry-nongit.", async (base) => {
		const home = join(base, "home");
		const plain = join(base, "plain");
		await mkdir(plain);
		await writeCarrier(home);
		const result = await registerProjectFromEntry(dshHome(home), { id: "p1", path: plain });
		assert.equal(result.ok, false);
		assert.equal(result.unavailable, undefined); // rejected, not unavailable
	});
});

// ---------------------------------------------------------------------------
// item 6 — 08 §6 host seam consumption
// ---------------------------------------------------------------------------

function fullComposition() {
	const seen = { guard: 0, invariants: 0, on: [], userQuestions: 0 };
	const ctx = {
		get: (key) => ({
			tools: { guard: (fn) => { seen.guard += 1; seen.guardFn = fn; return () => {}; } },
			invariants: { register: (name, factory) => { seen.invariants += 1; seen.invariantFactory = factory; seen.invariantName = name; return () => {}; } },
			userQuestions: { ask: async (request) => { seen.userQuestions += 1; return { answer: "ok", request }; } },
		}[key]),
		on: (event, fn) => { seen.on.push(event); return () => {}; },
		logger: { info() {} },
	};
	return { ctx, seen };
}

test("item6: only seams whose requirement is actually met are reported as consumed (08 §6)", async () => {
	const { ctx, seen } = fullComposition();
	const seams = createHostSeams();
	const install = seams.install(ctx, { dshHomePath: () => "/tmp/none" });

	assert.equal(seen.guard, 1, "ctx.tools.guard must receive exactly one monotonic guard");
	assert.equal(seen.invariants, 1, "ctx.invariants.register must receive one installer");
	assert.deepEqual(seen.on, ["fs/observed"]);

	const status = Object.fromEntries(seams.snapshot().map((s) => [s.seam, s]));
	assert.equal(status["ctx.tools.register"].state, "consumed");
	assert.equal(status["ctx.tools.guard"].state, "consumed");
	assert.equal(status["ctx.invariants.register"].state, "consumed");
	// These two are NOT honestly "consumed": mounting a counting listener is
	// not a read observation, and exposing `ask` without routing anything
	// through it routes nothing. Claiming otherwise is the exact false claim
	// 08 §6 forbids.
	assert.equal(status["fs/observed"].consumed, false);
	assert.equal(status["fs/observed"].state, "partial");
	assert.equal(status["ctx.userQuestions.ask"].consumed, false);
	assert.equal(status["ctx.userQuestions.ask"].state, "available");
	install.dispose();
});

test("item6: an absent seam is reported as unconsumed, never as protected (08 §6)", async () => {
	const seams = createHostSeams();
	const install = seams.install({ get: () => undefined, logger: { info() {} } }, { dshHomePath: () => "/tmp/none" });
	const status = Object.fromEntries(seams.snapshot().map((s) => [s.seam, s.consumed]));
	assert.equal(status["ctx.tools.guard"], false);
	assert.equal(status["ctx.invariants.register"], false);
	assert.equal(status["fs/observed"], false);
	assert.equal(status["ctx.userQuestions.ask"], false);
	install.dispose();
});

test("item6: the guard covers write-shaped ldvh_ tools and denies by returning a REASON STRING", async () => {
	const { ctx, seen } = fullComposition();
	const seams = createHostSeams();
	seams.install(ctx, { dshHomePath: () => "/tmp/none" });
	const guard = seen.guardFn;

	// Authoritative contract (cordis Inspect, Service `tools`):
	//   type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
	// The call name is `execution.name`; there is no `tool` / `scopeState`.
	// An unrelated host tool is never touched.
	assert.equal(guard({ name: "bash", agent: agentAt("/p") }), undefined);
	// A read-shaped LDVH tool is not write-shaped.
	assert.equal(guard({ name: "ldvh_read_specification_content", agent: agentAt("/p") }), undefined);
	// With no recorded judgement the guard stays silent — it only ADDS refusals.
	assert.equal(guard({ name: "ldvh_spark_write", agent: agentAt("/p") }), undefined);

	// Once the judgement for that cwd is unavailable, the write is refused…
	recordJudgementForGuard("/p", "unavailable");
	const denial = guard({ name: "ldvh_spark_write", agent: agentAt("/p") });
	assert.equal(typeof denial, "string", "a guard denies by returning a string, not an object");
	assert.match(denial, /unavailable/);

	// …read-shaped operations stay allowed, and a governed cwd is untouched.
	assert.equal(guard({ name: "ldvh_spark_write", agent: agentAt("/other") }), undefined);
	recordJudgementForGuard("/p", "governed");
	assert.equal(guard({ name: "ldvh_spark_write", agent: agentAt("/p") }), undefined);
});

test("item6: the invariant installer asserts the carrier schema at install time", async () => {
	await withTemp("ldvh-seam-inv.", async (base) => {
		const home = join(base, "home");
		const { ctx, seen } = fullComposition();
		createHostSeams().install(ctx, { dshHomePath: dshHome(home) });

		// Authoritative contract (cordis Inspect, Service `invariants`):
		//   interface InvariantInstaller { (ctx, fail): void | Promise<void> }
		//   type InvariantFailure = (message: string) => never
		// `fail` is CALLED to report a violation; there is no returned descriptor.
		assert.equal(typeof seen.invariantFactory, "function");
		assert.equal(seen.invariantName, "dsh-ldvh");

		// Absent carrier → a legitimate "unavailable" state, NOT a violation:
		// `fail` must not be called.
		let failed = null;
		const fail = (message) => { failed = message; throw new Error(message); };
		await seen.invariantFactory({}, fail);
		assert.equal(failed, null, "an absent carrier is not a schema violation");

		// A schema violation IS reported through `fail`.
		await writeCarrier(home, "schema_version: 99\n");
		let violation = null;
		await seen.invariantFactory({}, (message) => { violation = message; throw new Error(message); }).catch(() => {});
		assert.match(String(violation), /registration_schema_invalid/);
	});
});

// ---------------------------------------------------------------------------
// item 1 — 01 §9.2 items 8/9/11/12 mechanically checkable sub-parts
// ---------------------------------------------------------------------------

async function fixtureMember(base) {
	const root = await initRepo(base, { name: "specs-repo" });
	const specsDir = join(root, "specs");
	await mkdir(specsDir, { recursive: true });
	const markdown = [
		"---",
		"spec_key: demo-spec",
		"spec_id: 99",
		"title: Demo",
		"canonical_path: specs/99-Demo.md",
		"---",
		"",
		"# Demo",
		"",
		"## 1. One",
		"",
		"body",
		"",
	].join("\n");
	await writeFile(join(specsDir, "99-Demo.md"), markdown);
	await git(root, ["add", "-A"]);
	// Commit WITH the controlled-commit signature: item 11 checks signature
	// presence, so a fixture without trailers would fail that sub-part for a
	// reason unrelated to what these tests are about.
	await git(root, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "seed\n\nLDVH-Provider: test\nLDVH-Model: test"]);
	return { root, markdown, repoPath: "specs/99-Demo.md" };
}

test("item1: a fully evidenced carrier satisfies all four mechanical sub-parts but never claims membership", async () => {
	await withTemp("ldvh-ev.", async (base) => {
		const { root, markdown, repoPath } = await fixtureMember(base);
		const identity = { spec_key: "demo-spec", attachment_key: undefined };
		const { contentFingerprint } = await import("../lib/spec-registry.js");
		const report = await bindMembershipEvidence(root, [{ identity, markdownText: markdown, repoPath }], {
			bindings: { [repoPath]: contentFingerprint(markdown) },
			reviews: [{ ref: "docs/review-x.md", carriers: [repoPath] }],
			decisions: [{ ref: "docs/decisions.md", carriers: [repoPath] }],
		});
		const carrier = report.carriers[0];
		for (const item of ["8", "9", "11", "12"]) {
			assert.equal(carrier.items[item].satisfied, true, `item ${item}: ${JSON.stringify(carrier.items[item])}`);
		}
		// The whole point: mechanical satisfaction is NOT membership.
		assert.equal(carrier.membership_proven, false);
		assert.equal(report.gaps.length, 0);
		assert.match(report.guarantee, /NOT mechanically decidable/);
	});
});

test("item1: absent evidence produces gaps, never a silent pass", async () => {
	await withTemp("ldvh-ev-gap.", async (base) => {
		const { root, markdown, repoPath } = await fixtureMember(base);
		const identity = { spec_key: "demo-spec" };
		const report = await bindMembershipEvidence(root, [{ identity, markdownText: markdown, repoPath }], {});
		const carrier = report.carriers[0];
		assert.equal(carrier.items["8"].satisfied, false);
		assert.equal(carrier.items["9"].satisfied, false);
		// No recorded binding at all → item 12 must NOT be concluded as a pass.
		assert.equal(carrier.items["12"].concluded, false);
		assert.equal(carrier.membership_proven, false);
		// Item 11 passes (the fixture commit carries the signature); items 8/9
		// fail for absence of records and 12 is unconcluded — all three gap.
		assert.deepEqual(report.gaps.map((g) => g.item).sort(), ["12", "8", "9"]);
	});
});

test("item1: a stale fingerprint binding fails item 12", async () => {
	await withTemp("ldvh-ev-stale.", async (base) => {
		const { root, markdown, repoPath } = await fixtureMember(base);
		const identity = { spec_key: "demo-spec" };
		const report = await bindMembershipEvidence(root, [{ identity, markdownText: markdown, repoPath }], {
			bindings: { [repoPath]: "0000000000000000000000000000000000000000000000000000000000000000" },
		});
		assert.equal(report.carriers[0].items["12"].satisfied, false);
	});
});

test("item1: item 11 requires the controlled-commit signature, not merely a commit", async () => {
	await withTemp("ldvh-ev-commit.", async (base) => {
		const root = await initRepo(base, { name: "specs-repo" });
		const specsDir = join(root, "specs");
		await mkdir(specsDir, { recursive: true });
		const markdown = [
			"---",
			"spec_key: demo-spec",
			"spec_id: 99",
			"title: Demo",
			"canonical_path: specs/99-Demo.md",
			"---",
			"",
			"# Demo",
			"",
			"## 1. One",
			"",
			"body",
			"",
		].join("\n");
		const repoPath = "specs/99-Demo.md";
		await writeFile(join(root, repoPath), markdown);
		await git(root, ["add", "-A"]);
		// A plain commit: formed, but WITHOUT the controlled-commit trailers.
		await git(root, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "plain seed"]);
		const identity = { spec_key: "demo-spec" };

		const withoutSig = await bindMembershipEvidence(root, [{ identity, markdownText: markdown, repoPath }], {});
		assert.equal(withoutSig.carriers[0].items["11"].concluded, true, "a commit exists, so the item IS concluded");
		assert.equal(withoutSig.carriers[0].items["11"].satisfied, false, "but it carries no signature");

		// Now amend it into a signed commit and re-check.
		await git(root, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "--amend", "-m", "signed\n\nLDVH-Provider: p\nLDVH-Model: m"]);
		const withSig = await bindMembershipEvidence(root, [{ identity, markdownText: markdown, repoPath }], {});
		assert.equal(withSig.carriers[0].items["11"].satisfied, true);
		// Signature presence is explicitly NOT authorisation (01 §9.2).
		assert.match(withSig.carriers[0].items["11"].semantic_remainder, /does not prove the commit was authorised/);
	});
});

// ---------------------------------------------------------------------------
// item 4 (cont.) — 05 §6.1 mechanical declaration parsing
// ---------------------------------------------------------------------------

test("item4: operation declarations are PARSED from the source, not hardcoded (05 §6.1)", async () => {
	const { readFile } = await import("node:fs/promises");
	const { resolveHeadingPath, parseOperationDeclarations } = await import("../lib/spec-registry.js");
	const specPath = new URL("../../specs/07-工作对象与管辖范围规范.md", import.meta.url);
	const md = await readFile(specPath, "utf8");
	const rows = parseOperationDeclarations(md, (headingPath) => resolveHeadingPath(md, headingPath).ok);
	// Both 07 §5.4/§5.7 entries must be found, with their contract anchors
	// resolving — 05 §6.1 treats an unresolvable anchor as undeclared.
	assert.equal(rows.size, 2);
	for (const key of ["register-governed-project", "unregister-governed-project"]) {
		const row = rows.get(key);
		assert.ok(row, `${key} must be parsed from specs/07`);
		assert.equal(row.effect, "may_change_state");
		assert.deepEqual(row.anchor_errors, [], `${key} anchors must resolve`);
	}
});

test("item4: an unresolvable contract anchor is reported, never accepted (05 §6.1)", async () => {
	const { parseOperationDeclarations } = await import("../lib/spec-registry.js");
	const md = [
		"| operation_key | summary | effect | arguments_contract | result_contract |",
		"|---|---|---|---|---|",
		"| fake-op | does a thing | may_change_state | `99-Nope::1. Missing/9.9 Absent` | `99-Nope::1. Missing/9.8 Absent` |",
		"",
	].join("\n");
	const rows = parseOperationDeclarations(md, () => false); // nothing resolves
	const row = rows.get("fake-op");
	assert.equal(row.anchor_errors.length, 2);
	// A bad effect value is outside the closed set and must also be reported.
	const badEffect = parseOperationDeclarations(
		[
			"| operation_key | summary | effect | arguments_contract | result_contract |",
			"|---|---|---|---|---|",
			"| o | s | write | `A::B` | `A::C` |",
			"",
		].join("\n"),
		() => true
	);
	assert.match(badEffect.get("o").anchor_errors.join(" "), /outside the closed set/);
});

test("item4: discovery ACTUALLY parses declarations — the integration path, not just the parser (05 §6.1)", async () => {
	await withTemp("ldvh-disc-int.", async (base) => {
		// A governed project whose specs/ carries a real 05 §6.1 declaration.
		const repo = await initRepo(base, { name: "gov" });
		const specsDir = join(repo, "specs");
		await mkdir(specsDir, { recursive: true });
		const md = [
			"---",
			"ldvh_spec:",
			'  spec_key: "demo-cli"',
			'  spec_id: "05"',
			'  spec_kind: "spec"',
			'  title: "Demo CLI"',
			'  canonical_path: "specs/05-Demo.md"',
			'  parent_spec: ""',
			'  relation: ""',
			'  positioning: "demo positioning"',
			'  scope: "demo scope"',
			"---",
			"",
			"# Demo CLI",
			"",
			"## 6. Declarations",
			"",
			"### 6.1 Shape",
			"",
			"| operation_key | summary | effect | arguments_contract | result_contract |",
			"|---|---|---|---|---|",
			"| `<placeholder>` | `<not a declaration>` | `<read>` | `<a>` | `<b>` |",
			"",
			"| operation_key | summary | effect | arguments_contract | result_contract |",
			"|---|---|---|---|---|",
			"| resolve-governance-scope | resolve judgement | read | `demo-cli::6. Declarations/6.1 Shape` | `demo-cli::6. Declarations/6.1 Shape` |",
			"",
		].join("\n");
		await writeFile(join(specsDir, "05-Demo.md"), md);
		await git(repo, ["add", "-A"]);
		await git(repo, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "seed"]);

		const home = join(base, "home");
		await writeCarrier(home);
		// The session must actually be governed for a project root to exist.
		const registered = await registerProjectFromEntry(dshHome(home), { id: "gov", path: repo });
		assert.equal(registered.ok, true, JSON.stringify(registered));
		const { handlers } = makeExecute({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const exec = { agent: { session: { header: { cwd: repo } } } };
		const envelope = await handlers["discover-ldvh-capabilities"]({}, exec);

		const op = envelope.result.operations.find((o) => o.operation_key === "resolve-governance-scope");
		// The declaration must be found by the REAL call path (a path fed where
		// spec text is required would yield declaration: null here).
		assert.ok(op.declaration, "discovery must resolve the declaration from the spec carrier text");
		assert.equal(op.declaration.source_path, "specs/05-Demo.md");
		assert.equal(op.availability, "当次可调用");
		// The `<...>` template row must NOT become a phantom operation, and the
		// operations this fixture does NOT declare must be reported as such.
		const reported = (envelope.result.undeclared_or_unresolvable ?? []).map((e) => e.operation_key);
		assert.ok(!reported.includes("resolve-governance-scope"), "a declared operation must not be reported undeclared");
		assert.ok(!reported.some((k) => k.includes("placeholder")), "the <...> template must not become an operation");
		assert.equal(envelope.verification.passed, false, "six of seven operations are undeclared in this fixture");
	});
});

test("item4: an undeclared operation is reported as unavailable + diagnostic, never as declared (05 §6.1)", async () => {
	await withTemp("ldvh-disc-gap.", async (base) => {
		// A governed project with NO declaration tables anywhere.
		const repo = await initRepo(base, { name: "bare" });
		await mkdir(join(repo, "specs"), { recursive: true });
		await writeFile(join(repo, "specs", "01-Bare.md"), [
			"---", "spec_key: bare", "spec_id: 01", "title: Bare", "canonical_path: specs/01-Bare.md", "---", "", "# Bare", "", "## 1. One", "", "body", "",
		].join("\n"));
		await git(repo, ["add", "-A"]);
		await git(repo, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-qm", "seed"]);

		const home = join(base, "home");
		await writeCarrier(home);
		const registered = await registerProjectFromEntry(dshHome(home), { id: "bare", path: repo });
		assert.equal(registered.ok, true, JSON.stringify(registered));
		const { handlers } = makeExecute({ dshHomePath: dshHome(home), workspaceRoot: base, sessionPersistence: () => undefined });
		const envelope = await handlers["discover-ldvh-capabilities"]({}, { agent: { session: { header: { cwd: repo } } } });

		// Every operation is undeclared: availability must NOT be the positive
		// "已声明" label, and the diagnostics must be SURFACED (not dropped).
		for (const op of envelope.result.operations) {
			assert.notEqual(op.availability, "已声明", `${op.operation_key} must not claim declared`);
			assert.equal(op.availability, "不可用");
			assert.equal(op.declaration, null);
		}
		assert.equal(envelope.result.undeclared_or_unresolvable.length, envelope.result.operations.length);
		assert.equal(envelope.verification.passed, false);
		assert.ok(envelope.gaps.length >= envelope.result.operations.length);
	});
});
