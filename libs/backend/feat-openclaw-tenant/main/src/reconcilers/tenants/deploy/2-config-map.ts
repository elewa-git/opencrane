import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as k8s from "@kubernetes/client-node";

import type { OpenClawTenantOperatorConfig } from "../../../operator-config.types.js";
import type { AccessPolicy } from "@opencrane/backend/server/iam/policies";
import type { Tenant } from "../models/tenant.types.js";
import type { TenantModelSet } from "@opencrane/contracts";
import { _BuildTenantLabels } from "./tenant-labels.js";

/** Directory containing the workspace template files shipped with the operator. */
const _WORKSPACE_TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "workspace");

/** Absolute path inside the tenant pod where OpenClaw's persistent workspace lives. */
const _WORKSPACE_PATH = "/data/openclaw/workspace";

/**
 * Default agent reasoning posture — makes the model's thinking a first-class part
 * of the transcript so it streams live AND is returned by `chat.history` (the
 * org-admin SPA renders reasoning as a collapsible "Thinking" card).
 *
 * Verified against openclaw@2026.6.9 `AgentDefaultsConfig` (both keys are valid;
 * the operator's `agents.defaults` block is `.passthrough`, and OpenClaw accepts
 * them):
 *  - `reasoningDefault: "stream"` — deliver reasoning as it happens (as reasoning
 *    content parts on the assistant turn), so it persists into history rather than
 *    being dropped by the visible-history projection.
 *  - `thinkingDefault: "medium"` — a middle thinking level so reasoning-capable
 *    models actually produce a trace (with `"off"` there is nothing to show).
 *
 * These are platform defaults. Enabling reasoning has a real token-cost/latency cost.
 */
const _REASONING_DEFAULT = "stream";
const _THINKING_DEFAULT = "medium";

/**
 * The OpenClaw provider id the LiteLLM proxy is registered under (in `models.providers`).
 *
 * This id is ALSO the mandatory prefix on any model reference that must route through the proxy
 * (see `_toModelRef`). OpenClaw resolves a model reference by splitting on the FIRST `/`: the head
 * is the provider, the tail is the model. So a bare LiteLLM public name like `openai/gpt-5.5`
 * resolves to OpenClaw's BUILT-IN `openai` provider — which then demands a real OpenAI key in the
 * per-agent auth store and fails the first turn with `No API key found for provider "openai"`,
 * NEVER touching our `litellm-proxy` provider. Prefixing the reference (`litellm-proxy/openai/gpt-5.5`)
 * pins provider resolution to this proxy; OpenClaw strips the head and sends the tail (`openai/gpt-5.5`,
 * the LiteLLM public model name) upstream. The provider's own `models[].id` catalog stays BARE (the
 * name is relative to the provider), so only the *reference* — `agents.defaults.model` — is prefixed.
 */
const _LITELLM_PROVIDER_ID = "litellm-proxy";

/**
 * The official Cognee OpenClaw memory plugin id (npm `@cognee/cognee-openclaw`,
 * baked into the immutable tenant image). The operator gives it
 * exclusive ownership of OpenClaw's memory slot and renders its multi-scope config.
 */
const _COGNEE_PLUGIN_ID = "cognee-openclaw";

/**
 * Turn a LiteLLM public model name into an OpenClaw model REFERENCE that routes through the proxy.
 * See {@link _LITELLM_PROVIDER_ID} for why the provider prefix is mandatory.
 */
function _toModelRef(publicModelName: string): string
{
  return `${_LITELLM_PROVIDER_ID}/${publicModelName}`;
}

/**
 * Build the tenant ConfigMap that carries both OpenClaw runtime configuration
 * and the OpenCrane managed-runtime contract.
 *
 * The generated ConfigMap serves three purposes:
 * - `openclaw.json` provides the effective OpenClaw gateway/runtime config
 *   from platform-owned typed inputs.
 * - `opencrane-managed-runtime.json` gives the tenant runtime an explicit
 *   description of the platform context it is running under.
 * - Workspace files (`AGENTS.md`, `TOOLS.md`, `SOUL.md.seed`, etc.) are
 *   seeded into the OpenClaw agent workspace by `entrypoint.sh` on boot.
 *   L0 files (no `.seed` suffix) are re-stamped on every boot; L2 files
 *   (`.seed` suffix) are copied once and then tenant-owned.
 *
 * @param config - Operator runtime configuration.
 * @param tenant - The Tenant CR being reconciled.
 * @param namespace - Namespace the ConfigMap is written to.
 * @param effectivePolicy - The resolved AccessPolicy, when one applies.
 * @param modelSet - The tenant's allowed model set fetched best-effort from the
 *        opencrane-ui, or `null`. When LiteLLM is enabled the `litellm-proxy` provider runs in
 *        `replace` mode (it is the ONLY provider), restricted to these models with the default
 *        surfaced. An empty/null result yields `models: []` — and because there are no built-in
 *        providers to fall back to, the pod then has zero usable models. Cluster onboarding makes
 *        that impossible by requiring ≥1 registered model before a silo is provisioned; a transient
 *        opencrane-ui outage at reconcile is the only window it can occur, and it self-heals on the
 *        next successful fetch.
 * @param servingHost - The host the org's Control UI is served at (`<org>.<base>` or
 *        vanity), used to allowlist the browser Origin in `gateway.controlUi.allowedOrigins`.
 *        With `bind: lan` the gateway rejects a Control-UI WS whose Origin is not allowlisted
 *        (`CONTROL_UI_ORIGIN_NOT_ALLOWED`); the SPA reaches the gateway via this host, so its
 *        `https://<host>` origin must be allowed. Omitted ⇒ no origin is added (the gateway's
 *        own localhost seeding applies — the pre-same-origin behaviour).
 */
export function _BuildConfigMap(config: OpenClawTenantOperatorConfig, tenant: Tenant, namespace: string, effectivePolicy?: AccessPolicy, modelSet?: TenantModelSet | null, servingHost?: string): k8s.V1ConfigMap
{
  const name = tenant.metadata!.name!;

  // 0. Allowed models — the litellm-proxy provider (the ONLY provider under `replace` mode below)
  //    is restricted to the tenant's registered set. An empty or null result yields `[]`; with no
  //    built-ins to fall back to that means no usable models, which onboarding prevents by requiring
  //    ≥1 registered model before provisioning (the empty case is only reachable on a transient
  //    opencrane-ui outage at reconcile, and self-heals on the next fetch).
  const allowedModels = modelSet && modelSet.models.length > 0 ? [...modelSet.models] : [];
  const defaultModel = modelSet?.defaultModel ?? null;

  // Owner identity this pod is pinned to. The gateway-resolve delegate injects the
  // session's verified email trimmed + lowercased, so the allowlist MUST use the
  // same normalisation or it would lock the owner out.
  const ownerEmail = tenant.spec.email.trim().toLowerCase();

  // 1. Base runtime config — establish the OpenClaw gateway defaults that every
  //    tenant needs before any tenant-specific overrides are applied.
  const baseConfig: Record<string, unknown> = {
    gateway: {
      mode: "local",
      port: config.gatewayPort,
      bind: "lan",
      // Control-UI (org-admin SPA) policy:
      //  - allowedOrigins: with bind:lan the gateway enforces a Control-UI Origin allowlist
      //    (since v2026.2.26) and refuses an unlisted Origin with CONTROL_UI_ORIGIN_NOT_ALLOWED.
      //    The SPA reaches the gateway through the org host, so allow its https origin (when known).
      //  - dangerouslyDisableDeviceAuth: this platform is device-less by design — identity is the
      //    OIDC session the operator proxy verifies and injects as X-Forwarded-User (CONN.4), not a
      //    per-browser device key. Without this flag the gateway connects a trusted-proxy Control-UI
      //    but STRIPS its operator scopes (shouldClearUnboundScopesForMissingDeviceIdentity), so
      //    chat RPCs fail "missing scope". Disabling device auth lets the proxy be the authority and
      //    the connect's scopes stand. SAFE ONLY IF the gateway port is reachable solely through the
      //    proxy — enforced by the openclaw-<name>-gateway NetworkPolicy. NOTE: that requires the
      //    cluster to actually ENFORCE NetworkPolicy (Dataplane V2 / Calico); the dev cluster does
      //    not yet — tracked separately. The owner-pin (auth.allowUsers) is defence-in-depth, not a
      //    substitute (a caller that asserts the owner email is trusted under trusted-proxy).
      controlUi: {
        dangerouslyDisableDeviceAuth: true,
        ...(servingHost ? { allowedOrigins: [`https://${servingHost}`] } : {}),
      },
      // OC-2 / CONN.4 — the gateway delegates auth to the opencrane-ui: the pod
      // ingress validates the OIDC session and injects the user header, and the
      // gateway trusts it only from the configured proxy source. No shared token
      // (mutually exclusive with trusted-proxy); a NetworkPolicy locks the port
      // to the ingress so the trusted range can't be abused by other pods.
      //
      // Fail-closed by construction: OpenClaw treats an empty `trustedProxies`
      // as "trust no source" (gateway `isTrustedProxyAddress` returns false for
      // every IP when the list is empty), so when the operator was given no proxy
      // source the user header is never honoured and no connection authenticates —
      // an unconfigured operator denies, it does not trust-all. The internal
      // `config.gatewayTrustNothing` flag records this posture for the operator;
      // it is deliberately NOT rendered, because OpenClaw needs no extra marker
      // and its `trustedProxy` schema is strict (unknown keys crash the gateway).
      trustedProxies: config.gatewayTrustedProxies,
      // CONN.10 — pin the pod to its OWNER. trusted-proxy trusts whatever identity
      // the proxy injects, so without `allowUsers` ANY authenticated platform user
      // who reaches this pod (e.g. by hitting another tenant's host) is accepted as
      // themselves — a cross-tenant gap, since the pod holds the owner's mounted
      // secrets / MCP connections / model keys. `allowUsers` makes the gateway reject
      // any X-Forwarded-User that isn't the owner, so per-pod ownership is enforced
      // server-side regardless of how the connection is routed (host or identity proxy).
      auth: {
        mode: "trusted-proxy",
        trustedProxy: {
          userHeader: config.gatewayTrustedProxyUserHeader,
          allowUsers: [ownerEmail],
        },
      },
    },
    ...(config.liteLlmEnabled
      ? {
            models: {
              // `replace` (not `merge`): the litellm-proxy provider REPLACES OpenClaw's built-in
              // providers, so EVERY model call must go through LiteLLM — no bare-provider bypass of
              // the virtual key / budget metering / BYOK upstream key. This makes a non-empty model
              // allowlist a hard requirement (an empty list ⇒ the pod has zero usable models), which
              // cluster onboarding enforces by requiring at least one registered model before a silo
              // is provisioned (see fleet-operator ClusterTenant readiness). The BYOK key flow also
              // auto-seeds a default model, so a key-configured silo always satisfies this.
              mode: "replace",
              // NOTE: the default model is NOT set here. OpenClaw's `models` block is strict
              // and has no `default` key (only `mode` + `providers`) — a `models.default`
              // fails startup with "models: Invalid input". The effective default lives at
              // `agents.defaults.model` (set in step 4 below).
              providers: {
                [_LITELLM_PROVIDER_ID]: {
                  baseUrl: config.liteLlmEndpoint,
                  apiKey: "${LITELLM_API_KEY}",
                  api: "openai-completions",
                  // OpenClaw's config schema (verified against openclaw@2026.6.9
                  // plugin-sdk/config-schema) requires each provider model to be an OBJECT
                  // with `id` + `name` (both required) — NOT a bare string. Rendering strings
                  // makes the gateway fail startup with "models.providers.*.models.N: Invalid
                  // input". We use the LiteLLM public model name for both id and name.
                  models: allowedModels.map((model) => ({ id: model, name: model })),
                },
              },
            },
          }
      : {}),
  };

  // 2. Managed-runtime contract — publish OpenCrane-owned capabilities and
  //    tenant context in a machine-readable form for runtime features.
  //    mcp.servers and skills.entitled are advisory stubs only; the live
  //    compiled grant is served by GET /api/tenants/:name/effective-contract
  //    and re-pulled by the pod at each agentic-loop boundary. The ingress
  //    planes (Obot MCP Gateway, Skill Registry) are the authoritative boundary.
  const runtimeContract = {
    version: "opencrane-runtime/v1alpha1",
    contractVersion: "2.1.0",
    platform: "opencrane",
    mode: "managed",
    tenant: {
      name,
      team: tenant.spec.team ?? null,
      policyRef: tenant.spec.policyRef ?? null,
    },
    policy: {
      effectiveRef: effectivePolicy?.metadata?.name ?? tenant.spec.policyRef ?? null,
    },
    mcp: {
      gateway: config.mcpGatewayUrl,
      // Actual compiled server grants are fetched from effective-contract at runtime.
      servers: [],
    },
    skills: {
      registry: config.skillRegistryUrl,
      // Actual entitled skill index is fetched from effective-contract at runtime.
      entitled: [],
    },
    // Org-memory backend advertised to the runtime. Cognee IS the platform memory engine — a
    // settled dependency, not an option. When it is wired (COGNEE_ENDPOINT injected into the pod —
    // see 3-deployment.ts), the official `@cognee/cognee-openclaw` plugin owns OpenClaw's memory
    // slot (see the `plugins` block below) and retrieves org context DIRECTLY from the per-tenant
    // Cognee knowledge graph — auto-recalling scope-labeled context each turn. A `backend: "workspace"`
    // value is NOT a supported mode — it marks a MISCONFIGURED pod (no Cognee wired), which the pod
    // entrypoint surfaces as a startup warning; org memory is unavailable until an operator fixes it.
    memory: config.cogneeEndpoint
      ? {
          backend: "cognee",
          // Per-tenant Cognee base URL the plugin retrieves from (also injected as COGNEE_ENDPOINT).
          // Datasets are scope-partitioned (company / user / agent) by the plugin config below;
          // access is enforced by the Cognee-side grants the control plane syncs.
          endpoint: config.cogneeEndpoint,
        }
      : {
          backend: "workspace",
        },
    capabilities: {
      liteLlmProxy: config.liteLlmEnabled,
      hostingProvider: config.hostingProvider,
      persistentState: true,
      ephemeralSecrets: true,
      autoSuspend: config.idleTimeoutMinutes > 0,
    },
  };

  // 3. Platform-owned `meta` stub at the config root.
  //     exists solely to satisfy OpenClaw@2026.6.11's own config-integrity guard.
  //
  //     CORRECTED (see PR #171 — a first attempt at this, PR #170, rendered a bare `meta: {}`
  //     and was verified LIVE to still fail): the bundled openclaw.json has TWO same-named but
  //     DIFFERENT `hasConfigMeta` helpers (an esbuild artifact of two bundled modules). The one
  //     that actually gates the gateway-startup/config-observe path is `hasConfigMeta$1`
  //     (`dist/io-*.js`): `isRecord(value.meta) && (typeof value.meta.lastTouchedVersion ===
  //     "string" || typeof value.meta.lastTouchedAt === "string")` — NOT presence-only. A bare
  //     `{}` satisfies `isRecord` but neither string clause, so `hasConfigMeta$1` still returns
  //     false and `resolveConfigObserveSuspiciousReasons` still flags `missing-meta-vs-last-good`
  //     against the meta-stamped write `openclaw plugins install` leaves as "last known good" —
  //     confirmed by re-deploying PR #170 to elewa: a fresh `.clobbered.*` file appeared holding
  //     our correctly-rendered (but still-non-conforming) config, and the gateway reverted to
  //     `.bak` and rebooted with the stale pre-#168 plugin set. Re-verified this time against
  //     BOTH the downloaded openclaw@2026.6.11 tarball AND the literal installed binary inside
  //     the live pod (`/data/openclaw/runtime/node_modules/openclaw/dist/io-9CAVAPVZ.js`) before
  //     writing this fix — not inferred from a commit message.
  //
  //     `lastTouchedVersion` is a static, deterministic string (not a live timestamp) so the
  //     rendered ConfigMap never churns between reconciles — a moving `lastTouchedAt` would
  //     force a spurious redeploy/reload on every poll cycle.

  // 4. Platform-owned agent workspace settings. The workspace path is pinned to the
  //    persistent volume; skipBootstrap prevents interactive setup in the headless pod.
  const merged: Record<string, unknown> = {
    ...baseConfig,
    meta: { lastTouchedVersion: "opencrane-operator" },
    agents: {
      defaults: {
        // Reasoning visibility is a typed platform default and persists into chat.history.
        reasoningDefault: _REASONING_DEFAULT,
        thinkingDefault: _THINKING_DEFAULT,
        workspace: _WORKSPACE_PATH,
        skipBootstrap: true,
        // Effective default model (from the tenant's model set). OpenClaw reads the default
        // from `agents.defaults.model`, NOT `models.default`. Applied platform-side so it
        // cannot be dropped by runtime input. Omitted when no
        // default resolves (then OpenClaw falls back to its own model selection).
        //
        // MUST be prefixed with the litellm-proxy provider id (`_toModelRef`): OpenClaw resolves
        // the provider from the reference's leading segment, so a bare `openai/gpt-5.5` would bind
        // to the built-in `openai` provider (→ "No API key found for provider openai") instead of
        // routing through the proxy. The prefix pins it to `litellm-proxy`; the tail is sent upstream.
        ...(defaultModel ? { model: _toModelRef(defaultModel) } : {}),
      },
    },
  };

  // 5. Platform-owned memory plugin. When Cognee is wired, give the image-baked
  //    `@cognee/cognee-openclaw` plugin EXCLUSIVE ownership of OpenClaw's memory
  //    slot and disable the built-in `memory-core`. OpenClaw registers the memory capability ONLY for
  //    the slot owner, so the built-in's embedding index — which self-disables with "index metadata is
  //    missing" on a provider/model mismatch and would otherwise shadow this — never surfaces. The
  //    plugin auto-recalls scope-labeled context per turn and exposes the `cognee_memories` tool.
  //    Multi-scope is operator-configured: company (org-wide) / user (per IdP subject) / agent (per tenant).
  if (config.cogneeEndpoint)
  {
    const subject = tenant.spec.subject?.trim() || ownerEmail;
    merged["plugins"] = {
      load: { paths: ["/opt/openclaw/node_modules/@cognee/cognee-openclaw"] },
      // Security allowlist — only platform-approved plugins load (MUST be an array; an object crashes
      // OpenClaw's config parse). Forced platform-side so a tenant can't allow arbitrary plugins.
      allow: [_COGNEE_PLUGIN_ID],
      // Exclusive memory slot: OpenClaw skips memory-capability registration for any non-slot plugin,
      // so the stale built-in memory is fully out of the picture.
      slots: { memory: _COGNEE_PLUGIN_ID },
      entries: {
        // Retire the built-in memory provider (the source of the broken native `memory_search`).
        "memory-core": { enabled: false },
        [_COGNEE_PLUGIN_ID]: {
          enabled: true,
          // Grant the plugin its required hook permissions — verified live: without these, OpenClaw
          // blocks the plugin's typed hooks at gateway startup with "non-bundled plugins must set
          // plugins.entries.cognee-openclaw.hooks.<key>=true", and the plugin silently does nothing.
          // allowPromptInjection gates `before_prompt_build` (auto-recall — the whole point of this
          // plugin); allowConversationAccess gates `llm_output`/`agent_end` (session capture into
          // Cognee). Both are independent, currently-valid keys (verified in the installed
          // openclaw@2026.6.11 binary's config-normalization path) — the plugin's own README claims
          // allowConversationAccess was renamed/rejected pre-2026.4.2, but the live gateway explicitly
          // requested it by this exact name, so both are granted rather than trusting either source
          // alone.
          hooks: { allowPromptInjection: true, allowConversationAccess: true },
          config: {
            mode: "local",
            baseUrl: config.cogneeEndpoint,
            // Multi-scope partitioning. Setting company/user/agent dataset keys enables multi-scope
            // mode; identity is pinned to this tenant + its IdP subject so scopes never bleed across
            // tenants/users. Recall is most-specific-first; agent-authored memory writes to the agent scope.
            companyDataset: "company",
            userDatasetPrefix: "user",
            agentDatasetPrefix: "agent",
            userId: subject,
            agentId: name,
            recallScopes: ["agent", "user", "company"],
            defaultWriteScope: "agent",
          },
        },
      },
    };
  }

  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: `openclaw-${name}-config`,
      namespace,
      labels: _BuildTenantLabels(name),
    },
    data: {
      // OpenClaw consumes this file directly at tenant runtime startup.
      "openclaw.json": JSON.stringify(merged, null, 2),

      // OpenCrane-specific runtime metadata kept separate from OpenClaw's own config.
      "opencrane-managed-runtime.json": JSON.stringify(runtimeContract, null, 2),

      // L0 workspace files — platform-managed, re-stamped on every pod boot by entrypoint.sh.
      "AGENTS.md": _ReadWorkspaceTemplate("AGENTS.md"),
      "TOOLS.md": _ReadWorkspaceTemplate("TOOLS.md"),

      // L2 workspace files (.seed suffix) — copied once by entrypoint.sh when the
      // target file is absent; subsequent edits by the tenant are preserved.
      "SOUL.md.seed": _ReadWorkspaceTemplate("SOUL.md.seed"),
      "IDENTITY.md.seed": _ReadWorkspaceTemplate("IDENTITY.md.seed"),
      "USER.md.seed": _ReadWorkspaceTemplate("USER.md.seed"),
    },
  };
}

/**
 * Deterministic SHA-256 over a ConfigMap's `data` block, for the pod-template
 * `opencrane.io/config-checksum` annotation (see `_BuildDeployment`).
 *
 * WHY: OpenClaw reads `openclaw.json` only at process START. A mounted ConfigMap
 * update (e.g. a newly-registered BYOK default model landing in the `models`
 * block) refreshes the file on disk but does NOT restart the running process, so
 * a pod that booted before its models existed stays on the keyless
 * `gateway-injected` fallback forever. Stamping this digest on the pod template
 * makes any config change alter the template → the Recreate strategy rolls the
 * pod → OpenClaw re-reads the config and picks up the LiteLLM default model.
 *
 * Keys are sorted so the digest is stable across reconciles (no spurious rolls);
 * the values are the already-deterministic rendered config strings.
 */
export function _ConfigChecksum(configMap: k8s.V1ConfigMap): string
{
  const data = configMap.data ?? {};
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Read a workspace template file from the `workspace/` directory co-located with
 * this module.  At build time the files are copied to `dist/tenants/deploy/workspace/`
 * alongside the compiled JS, so the same relative path resolves in both source and dist.
 *
 * @param filename - Bare filename inside the workspace templates dir (e.g. `AGENTS.md`).
 */
function _ReadWorkspaceTemplate(filename: string): string
{
  return readFileSync(join(_WORKSPACE_TEMPLATES_DIR, filename), "utf-8");
}
