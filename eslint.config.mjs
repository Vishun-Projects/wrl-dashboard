import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "eslint-report.json",
    "scratch/**",
  ]),
  {
    rules: {
      /**
       * React Compiler eslint plugins flag intentional patterns in large client pages
       * (filter→reset page, hydrate from cache in effects, ref writes during render).
       * Keep off until those surfaces are Compiler-migrated — rewriting ReportPageClient
       * / SerialAudit just to silence lint risks the stable portal.
       */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "off",
      /** Legacy report/UI `any` surface — tighten file-by-file later. */
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
