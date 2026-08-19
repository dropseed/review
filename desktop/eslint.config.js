import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Deliberately narrow.
 *
 * `tsc --noEmit` already covers types and unused locals, and Prettier owns
 * formatting, so a broad "recommended" set here would mostly restate checks
 * that already run. What neither can see is hook correctness — a dependency
 * array that lies produces a stale closure, not a type error — and that is the
 * one class of bug this tree already carried suppression comments for, back
 * when there was no linter to suppress.
 *
 * `eslint-plugin-react-hooks` v6 also ships the React Compiler rule set
 * (`refs`, `set-state-in-effect`, `immutability`, `purity`, …). Those are left
 * off here, not because they are wrong — they report ~86 real things — but
 * because acting on them means reworking effects and render-phase ref writes
 * across the app, which is its own piece of work and not something to bundle
 * into turning the linter on. Enable them a rule at a time.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tauri/**",
      "public/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // tsc's noUnusedLocals reports these already, with better positions.
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    // Test doubles legitimately cast partial objects into store shapes.
    files: ["**/*.test.ts", "**/*.test.tsx", "ui/test/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
