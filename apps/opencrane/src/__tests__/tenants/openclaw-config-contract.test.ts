import { describe, expect, it } from "vitest";

import { defaultConfig, _makeTenant } from "../fixtures.js";
import { _BuildConfigMap } from "../../reconcilers/tenants/deploy/index.js";
import { _OpenclawConfigSchema } from "../../reconcilers/tenants/deploy/openclaw-config.schema.js";

/**
 * Mirrors `hasConfigMeta$1` EXACTLY as verified in the installed openclaw@2026.6.11 binary
 * (`dist/io-9CAVAPVZ.js:1121-1123`, re-confirmed inside a live pod after PR #170's `meta: {}`
 * was silently reverted in production) — a presence-only `meta` object does NOT satisfy it; a
 * string `lastTouchedVersion`/`lastTouchedAt` is required. Encoding the real predicate here
 * (not `toEqual({})`) is the point: PR #170's tests passed while the fix didn't actually work.
 * Module scope — shared by every describe block in this file.
 */
function _satisfiesOpenClawConfigMetaGuard(config: Record<string, unknown>): boolean
{
  const meta = config["meta"];
  if (typeof meta !== "object" || meta === null) return false;
  const m = meta as Record<string, unknown>;
  return typeof m["lastTouchedVersion"] === "string" || typeof m["lastTouchedAt"] === "string";
}

/**
 * Schema contract test for the rendered `openclaw.json` (task_d611ab4d, S1).
 *
 * OpenClaw's config schema is **strict** — an unknown key crashes the pod on boot
 * (the `trustNothing`-class crash fixed in f6afafd, where the operator leaked an
 * internal flag into the `gateway` block). Earlier this test was a no-dependency
 * structural allowlist because OpenClaw ships as a container, not an npm dep, so
 * its schema wasn't vendored. We now validate the rendered config against a
 * VENDORED zod mirror of OpenClaw's documented schema
 * (`openclaw-config.schema.ts`, pinned to OpenClaw 2026.6.x), which rejects stray
 * keys exactly as the live gateway does — covering the same regression class with
 * a real schema instead of a hand-maintained key list.
 */
describe("openclaw.json render contract — zod schema (task_d611ab4d)", function _suite()
{
  function _renderRaw(tenant = _makeTenant("contract")): string
  {
    const configMap = _BuildConfigMap(defaultConfig, tenant, "default");
    return configMap.data?.["openclaw.json"] ?? "{}";
  }

  function _renderConfig(tenant = _makeTenant("contract")): Record<string, unknown>
  {
    return JSON.parse(_renderRaw(tenant)) as Record<string, unknown>;
  }

  it("validates the default rendered config against the OpenClaw zod schema", function _schemaOk()
  {
    const parsed = _OpenclawConfigSchema.safeParse(_renderConfig());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
  });

  it("validates the LiteLLM-enabled config (models block) against the schema", function _modelsOk()
  {
    // Exercise the optional `models` branch so the provider/mode shape is covered.
    const liteLlmConfig = { ...defaultConfig, liteLlmEnabled: true };
    const configMap = _BuildConfigMap(liteLlmConfig, _makeTenant("contract"), "default");
    const parsed = _OpenclawConfigSchema.safeParse(JSON.parse(configMap.data?.["openclaw.json"] ?? "{}"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues, null, 2)).toBe(true);
  });

  it("validates the Cognee-wired config (plugins block) against the schema", function _pluginsOk()
  {
    // Exercise the optional `plugins` branch so the Cognee memory-plugin config shape is covered.
    const cogneeConfig = { ...defaultConfig, cogneeEndpoint: "http://cognee:8000" };
    const configMap = _BuildConfigMap(cogneeConfig, _makeTenant("contract"), "default");
    const parsed = _OpenclawConfigSchema.safeParse(JSON.parse(configMap.data?.["openclaw.json"] ?? "{}"));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error?.issues, null, 2)).toBe(true);
  });

  it("gives the Cognee plugin exclusive memory-slot ownership + disables the built-in", function _cogneePlugin()
  {
    // Adopt the official @cognee/cognee-openclaw plugin as the memory provider: it owns the memory
    // slot (so the built-in memory-core — the stale-index native memory_search — never registers)
    // and is configured multi-scope (company/user/agent) pinned to this tenant + its IdP subject.
    const cogneeConfig = { ...defaultConfig, cogneeEndpoint: "http://cognee:8000" };
    const config = JSON.parse(_BuildConfigMap(cogneeConfig, _makeTenant("contract"), "default").data?.["openclaw.json"] ?? "{}") as Record<string, unknown>;
    const plugins = config["plugins"] as Record<string, unknown>;
    expect(plugins["allow"]).toEqual(["cognee-openclaw"]);
    expect((plugins["slots"] as Record<string, unknown>)["memory"]).toBe("cognee-openclaw");
    const entries = plugins["entries"] as Record<string, { enabled?: boolean; hooks?: Record<string, unknown>; config?: Record<string, unknown> }>;
    expect(entries["memory-core"].enabled).toBe(false);
    expect(entries["cognee-openclaw"].enabled).toBe(true);
    // Hook permissions — without these OpenClaw blocks the plugin's typed hooks at gateway startup
    // (verified live: "non-bundled plugins must set plugins.entries.cognee-openclaw.hooks.<key>=true")
    // and auto-recall/session-capture silently do nothing despite the plugin showing "enabled".
    expect(entries["cognee-openclaw"].hooks).toEqual({ allowPromptInjection: true, allowConversationAccess: true });
    const cfg = entries["cognee-openclaw"].config as Record<string, unknown>;
    expect(cfg["baseUrl"]).toBe("http://cognee:8000");
    expect(cfg["companyDataset"]).toBe("company");
    expect(cfg["userDatasetPrefix"]).toBe("user");
    expect(cfg["agentDatasetPrefix"]).toBe("agent");
    expect(typeof cfg["agentId"]).toBe("string");
    expect(typeof cfg["userId"]).toBe("string");
    expect(cfg["recallScopes"]).toEqual(["agent", "user", "company"]);
    expect(cfg["defaultWriteScope"]).toBe("agent");
    // No stale native-memory config should linger from the removed bespoke MCP server.
    expect(config["mcp"]).toBeUndefined();
    expect((config["gateway"] as Record<string, unknown>)["reload"]).toBeUndefined();
  });

  it("renders a `meta` stub that satisfies OpenClaw's config-integrity guard", function _metaStub()
  {
    // Verified against openclaw@2026.6.11 (dist/io-*.js `hasConfigMeta$1`, re-confirmed inside a
    // live pod): a config observed without a string lastTouchedVersion/lastTouchedAt, after one
    // WITH it was last-known-good, is flagged "missing-meta-vs-last-good" and silently reverted
    // to the gateway's own .bak — exactly how a deploy's plugins/gateway/mcp changes failed to
    // reach the running pod (entrypoint's `openclaw plugins install` writes a meta-stamped config
    // just before our `cp -f` overwrote it). Assert the REAL predicate, not just key presence —
    // a bare `meta: {}` (PR #170) passes `isRecord` but not this, and still gets reverted.
    const config = _renderConfig();
    expect(_satisfiesOpenClawConfigMetaGuard(config)).toBe(true);
  });

  it("never leaks the internal trustNothing flag into the gateway block", function _noTrustNothing()
  {
    // The exact f6afafd regression: trustNothing is operator-internal, not an
    // OpenClaw key, so it must never appear anywhere in the rendered config and
    // the strict gateway schema would reject it if it did.
    expect(_renderRaw()).not.toContain("trustNothing");
  });

  it("rejects a stray key injected into the gateway block (regression guard)", function _strayKey()
  {
    // Tamper the rendered config the way the f6afafd bug did and prove the schema
    // fails closed — this is what protects the live pod from an unknown gateway key.
    const config = _renderConfig();
    (config["gateway"] as Record<string, unknown>)["trustNothing"] = true;
    expect(_OpenclawConfigSchema.safeParse(config).success).toBe(false);
  });

  it("pins the gateway to the owner email via allowUsers", function _ownerPin()
  {
    // CONN.10 — the operator-emitted config scopes the pod to its owner.
    const config = _renderConfig();
    const auth = (config["gateway"] as Record<string, unknown>)["auth"] as Record<string, unknown>;
    const trustedProxy = auth["trustedProxy"] as { allowUsers: string[] };
    expect(trustedProxy.allowUsers).toEqual(["contract@example.com"]);
  });
});

/**
 * Reasoning visibility — `agents.defaults.reasoningDefault`/`thinkingDefault` make
 * the model's thinking stream live AND persist into `chat.history` (rendered as a
 * collapsible "Thinking" card in the org-admin SPA).
 */
describe("reasoning visibility defaults", function _reasoningSuite()
{
  function _render(): Record<string, unknown>
  {
    const tenant = _makeTenant("contract");
    return JSON.parse(_BuildConfigMap(defaultConfig, tenant, "default").data?.["openclaw.json"] ?? "{}") as Record<string, unknown>;
  }

  function _defaults(config: Record<string, unknown>): Record<string, unknown>
  {
    return (config["agents"] as Record<string, unknown>)["defaults"] as Record<string, unknown>;
  }

  it("enables reasoning by default so it lands in history", function _default()
  {
    const defaults = _defaults(_render());
    expect(defaults["reasoningDefault"]).toBe("stream");
    expect(defaults["thinkingDefault"]).toBe("medium");
    expect(_OpenclawConfigSchema.safeParse(_render()).success).toBe(true);
  });

});
