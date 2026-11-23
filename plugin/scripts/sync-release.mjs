#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXCLUDED = ["ldvh-base/"];
const TARGET_KEEP = ["package.json"];
const APPLY_SKIP = [
	"plugin/package.json",
	"plugin/package-lock.json",
	"plugin/README.md",
	"plugin/README.en.md",
	"README.md",
];
const CHECK_EXEMPT = [...APPLY_SKIP, "plugin/CHANGELOG.md"];
const CHANGELOG = "plugin/CHANGELOG.md";

function parseArgs(argv) {
	const out = { mode: "check", source: "HEAD", target: null };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--check") out.mode = "check";
		else if (argv[i] === "--apply") out.mode = "apply";
		else if (argv[i] === "--source") out.source = argv[(i += 1)];
		else if (argv[i] === "--target") out.target = argv[(i += 1)];
		else {
			process.stderr.write(`sync-release: unknown argument ${argv[i]}\n`);
			process.exit(2);
		}
	}
	return out;
}

function git(repo, gitArgs, opts = {}) {
	return execFileSync("git", ["-C", repo, ...gitArgs], {
		encoding: opts.binary ? null : "utf8",
		maxBuffer: 1024 * 1024 * 256,
	});
}

function trackedTree(repo, ref) {
	const raw = git(repo, ["ls-tree", "-r", "-z", ref]);
	const map = new Map();
	for (const entry of raw.split("\0")) {
		if (!entry) continue;
		const tab = entry.indexOf("\t");
		if (tab < 0) continue;
		const oid = entry.slice(0, tab).split(" ")[2];
		map.set(entry.slice(tab + 1), oid);
	}
	return map;
}

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = parseArgs(process.argv.slice(2));
const targetRoot = args.target ?? join(dirname(srcRoot), `${basename(srcRoot)}-main-release`);

const srcAll = trackedTree(srcRoot, args.source);
const src = new Map();
for (const [path, oid] of srcAll) {
	if (EXCLUDED.some((dir) => path.startsWith(dir))) continue;
	src.set(path, oid);
}

const keepConflict = TARGET_KEEP.filter((p) => src.has(p));
if (keepConflict.length > 0) {
	process.stderr.write(`sync-release: dev 已开始跟踪 ${keepConflict.join("、")}，TARGET_KEEP 语义须复核后再同步\n`);
	process.exit(1);
}

const tgt = trackedTree(targetRoot, "HEAD");

const missing = [];
const differs = [];
for (const [path, oid] of src) {
	if (!tgt.has(path)) missing.push(path);
	else if (tgt.get(path) !== oid && !CHECK_EXEMPT.includes(path)) differs.push(path);
}
const extra = [];
for (const path of tgt.keys()) {
	if (!src.has(path) && !TARGET_KEEP.includes(path)) extra.push(path);
}
const changelogCarry =
	src.has(CHANGELOG) && tgt.has(CHANGELOG) && src.get(CHANGELOG) !== tgt.get(CHANGELOG);

const dirty = git(targetRoot, ["status", "--porcelain"]).trim();
if (dirty) {
	process.stderr.write("sync-release: target 有未提交改动，对比基于 HEAD；apply 前须先处理\n");
	if (args.mode === "apply") process.exit(1);
}

process.stdout.write(`sync-release ${args.mode}: source=${args.source} target=${targetRoot}\n`);
process.stdout.write(`missing（dev 有、main 无，apply 将写入）: ${missing.length}\n`);
for (const p of missing) process.stdout.write(`  + ${p}\n`);
process.stdout.write(`extra（main 有、dev 无，apply 将删除）: ${extra.length}\n`);
for (const p of extra) process.stdout.write(`  - ${p}\n`);
process.stdout.write(`differs（内容不同、非版本豁免，apply 将覆盖）: ${differs.length}\n`);
for (const p of differs) process.stdout.write(`  ~ ${p}\n`);
process.stdout.write(
	`changelog flow（CHANGELOG 随同步流过，发布条目由版本翻号补记）: ${changelogCarry ? "yes" : "no"}\n`,
);
if (changelogCarry) {
	process.stdout.write(
		"  注意：apply 将以 dev 的 CHANGELOG 覆盖 main 的——须先确认 dev 已补齐 main 侧既有的正式发布条目\n",
	);
}

if (args.mode === "apply") {
	const carries = [...missing, ...differs];
	if (changelogCarry) carries.push(CHANGELOG);
	for (const p of extra) rmSync(join(targetRoot, p), { force: true });
	for (const p of carries) {
		const dest = join(targetRoot, p);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, git(srcRoot, ["show", `${args.source}:${p}`], { binary: true }));
	}
	process.stdout.write(`applied；target 待提交改动（git status --porcelain）：\n`);
	process.stdout.write(git(targetRoot, ["status", "--porcelain"]));
	process.stdout.write("主控核对后受控提交；版本声明点由版本翻号步骤维护，本脚本不覆写\n");
}

process.exitCode = missing.length + extra.length + differs.length > 0 ? 1 : 0;
