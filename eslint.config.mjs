import tseslint from "typescript-eslint";

const piiImports = ["**/db/src/pii", "**/db/src/pii/**", "**/db/pii", "**/db/pii/**"];

function restrictedImports(group, message) {
  return { group, message };
}

export default tseslint.config(
  { ignores: ["**/.next/**", "**/dist/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    files: [
      "apps/web/app/[(]researcher[)]/**/*.{ts,tsx}",
      "apps/web/app/api/researcher/**/*.{ts,tsx}",
      "packages/ai/**/*.{ts,tsx}",
      "packages/ui/src/researcher/**/*.{ts,tsx}",
      "packages/services/src/ai/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        restrictedImports(piiImports, "Use the service interfaces for researcher and AI data."),
        restrictedImports(["**/(respondent)/**"], "Use shared packages across route groups."),
      ] }],
    },
  },
  {
    files: ["apps/web/app/[(]respondent[)]/**/*.{ts,tsx}", "apps/web/app/api/respondent/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        restrictedImports(["**/(researcher)/**"], "Use shared packages across route groups."),
      ] }],
    },
  },
);
