import tseslint from "typescript-eslint";

// Recommended TypeScript rules only; no stylistic rules.
export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
  ...tseslint.configs.recommended,
);
