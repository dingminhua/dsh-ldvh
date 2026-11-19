import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "web/**", "lib-old/**", "test/fixtures/**", "eslint.config.js"],
  },
  js.configs.recommended,
  {
    files: ["lib/**/*.js", "test/**/*.mjs", "lib/bin.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
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
