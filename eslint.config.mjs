/**
 * Root ESLint flat config — module-boundary enforcement only.
 *
 * Mechanical TypeScript style stays in `scripts/agent-style-check.sh` and per-package
 * `tsc --noEmit`; this config exists solely so the NX project graph can enforce the
 * capability scopes and dimensional tags declared in each project:
 *
 *   - `scope:<capability>` backend packages may use only their explicit graph edges.
 *   - `scope:shared` dependency-light packages may use approved shared/model contracts.
 *   - `scope:web` frontend packages may depend on web and shared packages.
 *   - `scope:app` entrypoints may compose libraries but cannot import another app.
 *
 * Phase B started dimensional tags on every new or touched project. Untagged legacy targets are
 * direct-deletion/refactor debt, while newly tagged projects are prevented from introducing
 * app-to-app, lib-to-app, or upward layer dependencies now.
 *
 * Run via `npm run lint:boundaries`.
 */
import nx from "@nx/eslint-plugin";
import tsEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** Enforces the package test-layout convention independently of Vitest discovery. */
const testLayout = {
  rules: {
    "require-tests-directory": {
      meta: {
        type: "problem",
        docs: { description: "require TypeScript tests to live below __tests__" },
        schema: [],
        messages: { misplacedTest: "Move this test below a __tests__ directory." },
      },
      create(context) {
        const filename = context.filename.replaceAll("\\", "/");

        if (filename.includes("/__tests__/")) {
          return {};
        }

        return {
          Program(node) {
            context.report({ node, messageId: "misplacedTest" });
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".claude/**",
      ".nx/**",
      "website/**",
      "libs/contracts/src/generated/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: { parser: tsParser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    // typescript-eslint is registered ONLY so pre-existing inline
    // `eslint-disable @typescript-eslint/*` directives resolve; no rules enabled.
    plugins: { "@nx": nx, "@typescript-eslint": tsEslint },
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            {
              sourceTag: "scope:shared",
              onlyDependOnLibsWithTags: [
                "scope:shared",
                "scope:agents",
                "scope:artifacts",
                "scope:authorization",
                "scope:auth",
                "scope:channel-proxy",
                "scope:http",
                "scope:tenant-hosting",
              ],
            },
            {
              // `scope:grants` is re-opened for slice 6 (#332) WITH a real import: the
              // PrismaScopeGrantResolver calls the grant compiler so an attach-authority check and
              // the runtime effective-access intersection grant nothing beyond the agent's actual
              // compiled grants. See scope-attachment-authority.ts + prisma-scope-grant-resolver.ts.
              sourceTag: "scope:agent-services",
              onlyDependOnLibsWithTags: ["scope:agent-services", "scope:agents", "scope:audit", "scope:authorization", "scope:grants", "scope:shared"],
            },
            {
              sourceTag: "scope:api-spec",
              onlyDependOnLibsWithTags: [
                "scope:api-spec",
                "scope:audit",
                "scope:awareness",
                "scope:grants",
                "scope:groups",
                "scope:mcp",
                "scope:metrics",
                "scope:model-routing",
                "scope:policies",
                "scope:projection",
                "scope:providers",
                "scope:retrieval",
                "scope:shared",
                "scope:skills",
                "scope:spend",
                "scope:tenants",
              ],
            },
            { sourceTag: "scope:audit", onlyDependOnLibsWithTags: ["scope:audit", "scope:shared"] },
            { sourceTag: "scope:authorization", onlyDependOnLibsWithTags: ["scope:audit", "scope:authorization", "scope:shared"] },
            { sourceTag: "scope:awareness", onlyDependOnLibsWithTags: ["scope:awareness", "scope:shared"] },
            { sourceTag: "scope:auth", onlyDependOnLibsWithTags: ["scope:auth", "scope:k8s-api", "scope:shared"] },
            { sourceTag: "scope:channel-proxy", onlyDependOnLibsWithTags: ["scope:channel-proxy", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-stream", onlyDependOnLibsWithTags: ["scope:agent-runtime-stream", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-launcher", onlyDependOnLibsWithTags: ["scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-runtime-controller", onlyDependOnLibsWithTags: ["scope:agent-runtime-controller", "scope:agent-runtime-launcher", "scope:shared"] },
            { sourceTag: "scope:agent-controller", onlyDependOnLibsWithTags: ["scope:agent-controller", "scope:agent-runtime-controller", "scope:shared"] },
            { sourceTag: "scope:cluster-tenants", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:k8s-api", "scope:shared"] },
            { sourceTag: "scope:company-docs", onlyDependOnLibsWithTags: ["scope:auth", "scope:company-docs", "scope:shared"] },
			{ sourceTag: "scope:conversation-replay", onlyDependOnLibsWithTags: ["scope:channel-targets", "scope:conversation-replay", "scope:shared"] },
            { sourceTag: "scope:connections", onlyDependOnLibsWithTags: ["scope:auth", "scope:connections", "scope:shared"] },
            { sourceTag: "scope:personal-conversations", onlyDependOnLibsWithTags: ["scope:agents", "scope:personal-conversations", "scope:shared"] },
			{ sourceTag: "scope:personal-configuration", onlyDependOnLibsWithTags: ["scope:personal-configuration", "scope:shared"] },
            {
              sourceTag: "scope:contract",
              onlyDependOnLibsWithTags: [
                "scope:awareness",
                "scope:contract",
                "scope:grants",
                "scope:model-routing",
                "scope:shared",
                "scope:tenants",
              ],
            },
            { sourceTag: "scope:grants", onlyDependOnLibsWithTags: ["scope:auth", "scope:grants", "scope:retrieval", "scope:shared"] },
            { sourceTag: "scope:groups", onlyDependOnLibsWithTags: ["scope:groups", "scope:shared"] },
            { sourceTag: "scope:http", onlyDependOnLibsWithTags: ["scope:http", "scope:shared"] },
            { sourceTag: "scope:integrations", onlyDependOnLibsWithTags: ["scope:integrations", "scope:obot-custody", "scope:shared"] },
            { sourceTag: "scope:k8s-api", onlyDependOnLibsWithTags: ["scope:k8s-api", "scope:shared"] },
            {
              sourceTag: "scope:identity",
              onlyDependOnLibsWithTags: [
                "scope:auth",
                "scope:cluster-tenants",
                "scope:connections",
                "scope:identity",
                "scope:projection",
                "scope:shared",
              ],
            },
            { sourceTag: "scope:mcp", onlyDependOnLibsWithTags: ["scope:auth", "scope:mcp", "scope:shared"] },
            { sourceTag: "scope:metrics", onlyDependOnLibsWithTags: ["scope:awareness", "scope:metrics", "scope:projection", "scope:shared"] },
            { sourceTag: "scope:membership", onlyDependOnLibsWithTags: ["scope:audit", "scope:authorization", "scope:membership", "scope:shared"] },
            { sourceTag: "scope:personal-memory", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:personal-memory", "scope:shared"] },
            { sourceTag: "scope:obot-custody", onlyDependOnLibsWithTags: ["scope:obot-custody", "scope:shared"] },
            { sourceTag: "scope:sandbox-execution", onlyDependOnLibsWithTags: ["scope:sandbox-execution", "scope:shared"] },
            { sourceTag: "scope:memory-gateway-client", onlyDependOnLibsWithTags: ["scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:model-routing", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:model-routing", "scope:shared"] },
            { sourceTag: "scope:policies", onlyDependOnLibsWithTags: ["scope:grants", "scope:k8s-api", "scope:policies", "scope:projection", "scope:shared"] },
            { sourceTag: "scope:personal-personas", onlyDependOnLibsWithTags: ["scope:personal-personas", "scope:shared"] },
            { sourceTag: "scope:projection", onlyDependOnLibsWithTags: ["scope:cluster-tenants", "scope:k8s-api", "scope:projection", "scope:shared"] },
            { sourceTag: "scope:execution-inputs", onlyDependOnLibsWithTags: ["scope:agents", "scope:artifacts", "scope:membership", "scope:execution-runs", "scope:execution-inputs", "scope:shared"] },
            { sourceTag: "scope:providers", onlyDependOnLibsWithTags: ["scope:auth", "scope:cluster-tenants", "scope:model-routing", "scope:providers", "scope:shared"] },
            { sourceTag: "scope:retrieval", onlyDependOnLibsWithTags: ["scope:retrieval", "scope:shared"] },
            { sourceTag: "scope:execution-runs", onlyDependOnLibsWithTags: ["scope:agents", "scope:authorization", "scope:execution-runs", "scope:shared"] },
            { sourceTag: "scope:execution-protocol", onlyDependOnLibsWithTags: ["scope:execution-protocol", "scope:execution-inputs", "scope:agents", "scope:authorization", "scope:obot-custody", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:agent-runtime", onlyDependOnLibsWithTags: ["scope:agent-runtime", "scope:agents", "scope:authorization", "scope:execution-protocol", "scope:obot-custody", "scope:sandbox-execution", "scope:memory-gateway-client", "scope:shared"] },
            { sourceTag: "scope:skills", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:cluster-tenants", "scope:grants", "scope:shared", "scope:skills"] },
            { sourceTag: "scope:spend", onlyDependOnLibsWithTags: ["scope:shared", "scope:spend"] },
            { sourceTag: "scope:tenant-hosting", onlyDependOnLibsWithTags: ["scope:shared", "scope:tenant-hosting"] },
            {
              sourceTag: "scope:tenants",
              onlyDependOnLibsWithTags: [
                "scope:connections",
                "scope:grants",
                "scope:k8s-api",
                "scope:projection",
                "scope:retrieval",
                "scope:shared",
                "scope:spend",
                "scope:tenants",
              ],
            },
            { sourceTag: "scope:web", onlyDependOnLibsWithTags: ["scope:web", "scope:shared"] },
            { sourceTag: "scope:app", onlyDependOnLibsWithTags: ["*"] },
            { sourceTag: "scope:agents", onlyDependOnLibsWithTags: ["scope:agents", "scope:shared"] },
            { sourceTag: "scope:artifacts", onlyDependOnLibsWithTags: ["scope:artifacts", "scope:shared"] },
            { sourceTag: "type:app", notDependOnLibsWithTags: ["type:app"] },
            { sourceTag: "type:lib", notDependOnLibsWithTags: ["type:app"] },
            {
              sourceTag: "layer:backend",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:frontend"],
            },
            {
              sourceTag: "layer:infra",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:backend", "layer:frontend"],
            },
            {
              sourceTag: "layer:frontend",
              notDependOnLibsWithTags: ["layer:entrypoint", "layer:backend", "layer:infra"],
            },
            {
              sourceTag: "layer:contract",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:frontend",
                "layer:infra",
              ],
            },
            {
              sourceTag: "layer:model",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:contract",
                "layer:frontend",
                "layer:infra",
              ],
            },
            {
              sourceTag: "layer:util",
              notDependOnLibsWithTags: [
                "layer:entrypoint",
                "layer:backend",
                "layer:contract",
                "layer:frontend",
                "layer:infra",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // Vitest configs are build tooling, not product modules: every one imports the
    // root vitest.cache.js helper by relative path (the ROOT-CACHE style rule requires
    // it), which the boundaries rule would misread as an unregistered external import.
    files: ["**/vitest.config.ts"],
    rules: { "@nx/enforce-module-boundaries": "off" },
  },
  {
    files: ["**/*.test.ts"],
    plugins: { "test-layout": testLayout },
    rules: { "test-layout/require-tests-directory": "error" },
  },
];
