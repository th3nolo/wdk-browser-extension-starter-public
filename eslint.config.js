import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typedSourceFiles = ["src/**/*.{ts,tsx}", "entrypoints/**/*.ts"];

export default tseslint.config(
  {
    ignores: [
      ".output/**",
      ".tmp-*/**",
      ".tmp-chrome-profile-*/**",
      ".tmp-demo-profile-*/**",
      ".tmp-manual-chrome/**",
      ".tmp-manual-chrome*/**",
      ".tmp-manual-edge/**",
      ".tmp-manual-edge*/**",
      ".wxt/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "scripts/**",
      "website/**",
      "eslint.config.js"
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: typedSourceFiles,
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false, arguments: false } }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  // White-label boundary: the UI shell is swappable and may import the core
  // ONLY through the curated SDK (`src/sdk/**`), never by reaching into `src/lib`.
  {
    files: ["src/ui/**/*.{ts,tsx}", "entrypoints/popup/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/lib/**"], message: "UI must import core only via ../sdk" }
        ]
      }]
    }
  },
  // The core + SDK are headless: no UI or React may leak into them.
  {
    files: [
      "src/lib/**/*.{ts,tsx}",
      "src/sdk/**/*.{ts,tsx}",
      "entrypoints/background.ts",
      "entrypoints/content.ts",
      "entrypoints/inpage.ts"
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/ui/**"], message: "core/SDK is headless; no UI/React" }
        ],
        paths: [
          { name: "react", message: "core/SDK is headless; no UI/React" },
          { name: "react-dom", message: "core/SDK is headless; no UI/React" }
        ]
      }]
    }
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  }
);
