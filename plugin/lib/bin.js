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

/**
 * 07 §5.6 refusal shape for a CLI invocation that lacks the explicit-intent
 * carrier. A CLI has no host answerer to ask, so the Human running the command
 * must state the intent; a bare invocation is not consent.
 */
function humanIntentRequired(what, flag) {
  return {
    ok: false,
    error: {
      code: "human_intent_required",
      message: `07 §5.6 requires explicit Human intent: ${what}, so re-run with ${flag} to record that a Human decided it`,
      details: { required_flag: flag }
    }
  };
}

function usage() {
  process.stderr.write("Usage: dsh-ldvh governed-project <list|inspect|install|uninstall-hook|register|unregister> [--project ABSOLUTE_GIT_ROOT] [--id PROJECT_ID] [--human-confirmed]\n");
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
      // 07 §5.4/§5.6: the installation transaction REGISTERS the project, so it
      // is a registration write and needs the same explicit-intent carrier as
      // `register`. (08 §5.2's settings-page click is the Web carrier; a CLI
      // invocation has no click, hence the flag.) Enforcing this on `register`
      // but not here left the whole gate bypassable by one command.
      if (!argv.includes("--human-confirmed")) {
        result = humanIntentRequired("installation registers the project", "--human-confirmed");
      } else {
        result = await installProject(dshHomePath, {
          id,
          path: project,
          name: valueAfter(argv, "--name"),
          description: valueAfter(argv, "--description")
        }, { runnerPath, workspaceRoot: packageRoot });
      }
    } else if (command === "uninstall-hook") {
      // Removing the managed hook weakens a live mechanical protection while
      // the project stays governed, so it carries the same intent requirement.
      if (!argv.includes("--human-confirmed")) {
        result = humanIntentRequired("removing the managed Git hook weakens enforcement", "--human-confirmed");
      } else {
        result = await uninstallHook(project);
      }
    }
    else if (command === "register") {
      const id = valueAfter(argv, "--id");
      if (id === void 0) {
        process.stderr.write("register requires --id PROJECT_ID\n");
        return 2;
      }
      // 07 §5.6: "登记或取消仅由 Human 明确意图触发". A CLI invocation has no
      // host answerer to ask, so the intent must be carried EXPLICITLY by the
      // Human running the command. The flag is that carrier; without it the
      // entry must fail closed rather than treat the invocation as consent.
      if (!argv.includes("--human-confirmed")) {
        result = humanIntentRequired("registration changes who is governed", "--human-confirmed");
      } else {
        result = await registerProjectFromEntry(dshHomePath, {
          id,
          path: project,
          name: valueAfter(argv, "--name"),
          description: valueAfter(argv, "--description")
        });
      }
    } else if (command === "unregister") {
      const id = valueAfter(argv, "--id");
      if (id === void 0) {
        process.stderr.write("unregister requires --id PROJECT_ID\n");
        return 2;
      }
      // 07 §5.6 applies to cancellation too: same explicit-intent carrier.
      if (!argv.includes("--human-confirmed")) {
        result = humanIntentRequired("cancellation changes who is governed", "--human-confirmed");
      } else {
        result = await unregisterProject(dshHomePath, { id, path: project, nextDefaultProjectId: valueAfter(argv, "--next-default") });
      }
    } else {
      usage();
      return 2;
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
