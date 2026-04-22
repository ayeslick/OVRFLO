import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // R18: the production bundle must never ship console noise. Warn
      // and error channels stay allowed for dev diagnostics — those are
      // legitimate signals callers can opt into.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Build scripts run in Node and legitimately write to stdout.
    files: ["scripts/**/*.{mjs,js,ts}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  }
);
