import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,   // require, module, process, __dirname, console
        ...globals.jest,   // describe, it, expect, beforeEach, afterEach
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "eqeqeq": "error",
      "no-eval": "error",
    }
  }
];