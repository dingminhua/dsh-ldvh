// ESLint flat config (plugin lint surface).
//
// Scope: the plugin's own runtime code (lib/), tests (test/) and the bin
// entry — the surfaces the 09 §5 test baseline covers. The web/ frontend is
// a separate TypeScript/Vite app with its own toolchain and is linted there;
// fixtures are test inputs, not product code.
//
// Rule posture (2026-09 hygiene batch):
//  - lib/: recommended + no-unused-vars (underscore strip pattern ignored,
//    deliberate catch-ignores allowed). Clean on adoption.
//  - test/: no-unused-vars off — fixtures keep unused destructures by
//    convention (assertion helpers, arity mirrors).
//  - preserve-caught-error / no-useless-assignment: adopted as OFF for now
//    (they flag pre-existing code outside this batch's scope); enable after
//    a dedicated triage. Everything else stays on.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "web/**", "test/fixtures/**", "eslint.config.js"],
  },
  js.configs.recommended,
  {
    files: ["lib/**/*.js", "test/**/*.mjs", "lib/bin.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // The `const { change_summary: _stripped, ...rest }` carrier-strip
      // pattern is deliberate; caught-error bindings are the "already
      // removed" disposer idiom.
      "no-unused-vars": ["error", { caughtErrors: "none", args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "preserve-caught-error": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["test/**/*.mjs"],
    rules: {
      "no-unused-vars": "off",
    },
  },
];
