import tseslint from "typescript-eslint";
import integerCents from "./tools/eslint/integer-cents.mjs";

import routeOwner from "./tools/eslint/route-owner.mjs";

const piiImports = ["**/db/src/pii", "**/db/src/pii/**", "**/db/pii", "**/db/pii/**"];

function restrictedImports(group, message) {
  return { group, message };
}

export default tseslint.config(
  { ignores: ["**/.next/**", "**/dist/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["{apps,packages}/**/*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}"],
    // Negative test fixtures deliberately pass fractional values to runtime validators.
    ignores: ["**/{test,tests,e2e}/**", "**/*.{spec,test}.*"],
    plugins: { envoi: { rules: { "integer-cents": integerCents } } },
    rules: { "envoi/integer-cents": "error" },
  },
  {
    files: [
      "apps/web/app/[(]researcher[)]/**/*.{ts,tsx}",
      "apps/web/app/api/researcher/**/*.{ts,tsx}",
      "packages/ai/**/*.{ts,tsx}",
      "packages/ui/src/researcher/**/*.{ts,tsx}",
      "packages/services/src/ai/**/*.{ts,tsx}",
    ],
    plugins: { boundaries: { rules: { "route-owner": routeOwner } } },
    rules: {
      "boundaries/route-owner": ["error", "respondent"],
      "no-restricted-imports": ["error", { patterns: [
        restrictedImports(piiImports, "Use the service interfaces for researcher and AI data."),
        restrictedImports(["**/(respondent)/**"], "Use shared packages across route groups."),
      ] }],
    },
  },
  {
    files: ["apps/web/app/[(]respondent[)]/**/*.{ts,tsx}", "apps/web/app/api/respondent/**/*.{ts,tsx}"],
    plugins: { boundaries: { rules: { "route-owner": routeOwner } } },
    rules: {
      "boundaries/route-owner": ["error", "researcher"],
      "no-restricted-imports": ["error", { patterns: [
        restrictedImports(["**/(researcher)/**"], "Use shared packages across route groups."),
      ] }],
    },
  },
);
