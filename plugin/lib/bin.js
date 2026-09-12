#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { inspectCandidate, installProject, readGovernedProjects, registerProjectFromEntry, unregisterProject, uninstallHook } from "./governed-projects.js";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { join } from "node:path";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runnerPath = fileURLToPath(new URL("./git-gate-runner.js", import.meta.url));
const dshHomePath = (...segments) => join(resolveDshHome(), ...segments);

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return void 0;
  return args[index + 1];
}

function usage() {
  process.stderr.write("Usage: dsh-ldvh governed-project <list|inspect|install|uninstall-hook|unregister|register> [--project ABSOLUTE_GIT_ROOT] [--id PROJECT_ID]\n");
}

async function main(argv) {
  if (argv[0] !== "governed-project") {
    usage();
    return 2;
  }
  const command = argv[1];
  let result;
  if (command === "list") result = await readGovernedProjects(dshHomePath);
  else {
    const project = valueAfter(argv, "--project");
    if (project === void 0) {
      usage();
      return 2;
    }
    if (command === "inspect") result = await inspectCandidate(project);
    else if (command === "install") {
      const id = valueAfter(argv, "--id");
      if (id === void 0) {
        process.stderr.write("install requires --id PROJECT_ID\n");
        return 2;
      }
      result = await installProject(dshHomePath, {
        id,
        path: project,
        name: valueAfter(argv, "--name"),
        description: valueAfter(argv, "--description")
      }, { runnerPath, workspaceRoot: packageRoot });
    } else if (command === "uninstall-hook") result = await uninstallHook(project);
    else if (command === "register") {
      const id = valueAfter(argv, "--id");
      if (id === void 0) {
        process.stderr.write("register requires --id PROJECT_ID\n");
        return 2;
      }
      result = await registerProjectFromEntry(dshHomePath, {
        id,
        path: project,
        name: valueAfter(argv, "--name"),
        description: valueAfter(argv, "--description")
      });
    } else if (command === "unregister") {
      const id = valueAfter(argv, "--id");
      if (id === void 0) {
        process.stderr.write("unregister requires --id PROJECT_ID\n");
        return 2;
      }
      result = await unregisterProject(dshHomePath, { id, path: project, nextDefaultProjectId: valueAfter(argv, "--next-default") });
    } else {
      usage();
      return 2;
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
