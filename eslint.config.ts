import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import perfectionist from "eslint-plugin-perfectionist";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist", "node_modules"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
    plugins: {
      import: importPlugin,
      perfectionist,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "import/no-unresolved": [
        "error",
        {
          ignore: ["^bun:test$", "^eslint/config$", "^typescript-eslint$"],
        },
      ],
      "no-console": "off",
      "padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          next: "return",
          prev: "*",
        },
        {
          blankLine: "always",
          next: ["if", "for", "while"],
          prev: "*",
        },
        {
          blankLine: "always",
          next: "*",
          prev: "if",
        },
        {
          blankLine: "always",
          next: "*",
          prev: "block-like",
        },
      ],
      "perfectionist/sort-object-types": "error",
      "perfectionist/sort-objects": "error",
      "simple-import-sort/exports": "error",
      "simple-import-sort/imports": "error",
    },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
  },
  eslintConfigPrettier,
);
