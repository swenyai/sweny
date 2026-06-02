import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

export default [
  // Global ignores
  {
    ignores: [
      "**/dist/",
      "**/dist-tsc/",
      "**/node_modules/",
      "**/.next/",
      "**/coverage/",
      "packages/web/.astro/**",
      "spec/.astro/**",
      ".claude/**",
      "**/*.d.ts",
      // Local git worktrees (gitignored). Without this, `eslint .` lints
      // every checkout under .worktrees/ and inflates the warning count.
      ".worktrees/**",
    ],
  },

  // TypeScript files (incl. .tsx — studio React source was previously unlinted
  // because a flat-config block matching no files is skipped).
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Core rules
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "warn",

      // Basic TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },

  // CLI — console output is intentional in a CLI tool. The CLI moved from the
  // removed packages/cli into packages/core/src/cli; this override was dead.
  {
    files: ["packages/core/src/cli/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // Studio React source. Now that .tsx is linted, the existing
  // `// eslint-disable react-hooks/exhaustive-deps` directives in studio
  // reference rules that aren't registered, which ESLint reports as an error
  // ("Definition for rule ... was not found"). Register the react-hooks rule
  // ids as no-ops (off) so those directives resolve cleanly without pulling in
  // eslint-plugin-react-hooks or surfacing a wave of new warnings. Swap these
  // for the real plugin if/when studio adopts full hooks linting.
  {
    files: ["packages/studio/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
          "rules-of-hooks": { create: () => ({}) },
        },
      },
    },
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },

  // Test files — relax rules that add noise without value in tests
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Disable formatting rules that conflict with Prettier
  prettier,
];
