import { titanpl } from 'eslint-plugin-titanpl';
import tsParser from "@typescript-eslint/parser";

export default [
  titanpl,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
  },
];