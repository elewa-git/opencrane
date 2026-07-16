import { describe, expect, it, vi, afterEach } from "vitest";
import pino from "pino";
import type * as k8s from "@kubernetes/client-node";

import { defaultConfig, onPremAdapter, _makeTenant } from "../fixtures.js";
import { _ResolveTenantModelGate } from "../../reconcilers/tenants/deploy/model-gate.js";
import { _BuildConfigMap, _ConfigChecksum } from "../../reconcilers/tenants/deploy/index.js";
import { TenantOperator } from "../../reconcilers/tenants/operator.js";
import { TenantStatusWriter } from "../../reconcilers/tenants/internal/tenant-status-writer.js";
import { TenantDegradedReason, TenantStatusPhase, type TenantStatus } from "../../reconcilers/tenants/models/tenant-status.interface.js";
import type { TenantModelSet } from "@opencrane/contracts";

const _log = pino({ level: "silent" });

/**
 * Fail-safe reconcile — issue #144.
 *
 * A reconcile whose `tenant-models` read is empty or failing must NOT re-render the
 * openclaw ConfigMap from that read (which would emit `models: []` + no default and
 * drop openclaw to the keyless built-in provider → `missing-provider-auth`). It keeps
 * the last-applied ConfigMap and marks the Tenant Degraded. A valid read renders as
 * before, and a first-ever provision is allowed to render even without models.
 */
describe("_ResolveTenantModelGate (issue #144)", function _gateSuite()
{
  it("renders when LiteLLM is disabled regardless of the fetch outcome", function _liteLlmOff()
  {
    // No `models` block is emitted when LiteLLM is off, so there is no model-less
    // failure mode to guard — always safe to render.
    for (const status of ["ok", "empty", "error"] as const)
    {
      expect(_ResolveTenantModelGate(status, false, true)).toEqual({ action: "render" });
      expect(_ResolveTenantModelGate(status, false, false)).toEqual({ action: "render" });
    }
  });

  it("renders on a valid (ok) model set", function _ok()
  {
    expect(_ResolveTenantModelGate("ok", true, true)).toEqual({ action: "render" });
    expect(_ResolveTenantModelGate("ok", true, false)).toEqual({ action: "render" });
  });

  it("renders on empty/error when there is NO existing ConfigMap (first provision)", function _firstProvision()
  {
    // Nothing good exists to protect and skipping would deadlock provisioning; the
    // model-less config self-heals on the next successful fetch.
    expect(_ResolveTenantModelGate("empty", true, false)).toEqual({ action: "render" });
    expect(_ResolveTenantModelGate("error", true, false)).toEqual({ action: "render" });
  });

  it("skips (Degraded/ModelSetEmpty) on an empty fetch over an existing ConfigMap", function _skipEmpty()
  {
    const decision = _ResolveTenantModelGate("empty", true, true);
    expect(decision.action).toBe("skip-degraded");
    if (decision.action !== "skip-degraded") throw new Error("unreachable");
    expect(decision.reason).toBe(TenantDegradedReason.ModelSetEmpty);
  });

  it("skips (Degraded/ModelFetchFailed) on a failed fetch over an existing ConfigMap", function _skipError()
  {
    const decision = _ResolveTenantModelGate("error", true, true);
    expect(decision.action).toBe("skip-degraded");
    if (decision.action !== "skip-degraded") throw new Error("unreachable");
    expect(decision.reason).toBe(TenantDegradedReason.ModelFetchFailed);
  });
});

describe("_BuildConfigMap never emits a bare (unprefixed) model (issue #144)", function _renderSuite()
{
  function _openclaw(modelSet: TenantModelSet | null): Record<string, unknown>
  {
    const liteLlmConfig = { ...defaultConfig, liteLlmEnabled: true };
    const configMap = _BuildConfigMap(liteLlmConfig, _makeTenant("acme"), "default", undefined, modelSet);
    return JSON.parse(configMap.data?.["openclaw.json"] ?? "{}") as Record<string, unknown>;
  }

  function _defaultModel(config: Record<string, unknown>): unknown
  {
    const agents = config["agents"] as Record<string, unknown>;
    return (agents["defaults"] as Record<string, unknown>)["model"];
  }

  it("prefixes a resolved default with litellm-proxy, never the bare built-in", function _prefixed()
  {
    const config = _openclaw({ models: ["openai/gpt-5.5"], defaultModel: "openai/gpt-5.5" });
    expect(_defaultModel(config)).toBe("litellm-proxy/openai/gpt-5.5");
    // The bare reference (which would bind openclaw's built-in openai provider) must
    // never appear as the effective default.
    expect(_defaultModel(config)).not.toBe("openai/gpt-5.5");
  });

  it("leaves agents.defaults.model UNSET when no default resolves", function _unset()
  {
    // With an empty/absent model set the render omits the default rather than emitting a
    // bare one — openclaw is left with no default instead of the keyless built-in.
    const emptySet = _openclaw({ models: [], defaultModel: null });
    expect(_defaultModel(emptySet)).toBeUndefined();
    expect(_openclaw(null)["agents"]).toBeDefined();
    expect(_defaultModel(_openclaw(null))).toBeUndefined();
  });
});

/**
 * Minimal K8s client harness for driving `reconcileTenant` end-to-end. The typed
 * clients expose only the create/replace/read methods `__K8sApplyResource` reaches for
 * (it has no generic `.create`, so it falls through to the `createNamespaced*` switch).
 * Records every applied resource by kind so a test can assert what the reconcile wrote.
 */
function _buildHarness(options: { existingConfigMap?: k8s.V1ConfigMap | null })
{
  const applied: Record<string, k8s.KubernetesObject[]> = {};
  function _record(resource: k8s.KubernetesObject): k8s.KubernetesObject
  {
    const kind = resource.kind ?? "unknown";
    (applied[kind] ??= []).push(resource);
    return resource;
  }

  const notFound = Object.assign(new Error("not found"), { statusCode: 404 });

  const coreApi = {
    createNamespacedServiceAccount: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
    createNamespacedConfigMap: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
    createNamespacedService: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
    createNamespacedPersistentVolumeClaim: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
    readNamespacedPersistentVolumeClaim: vi.fn(async () => { throw notFound; }),
    readNamespacedConfigMap: vi.fn(async () => {
      if (options.existingConfigMap) return options.existingConfigMap;
      throw notFound;
    }),
  } as unknown as k8s.CoreV1Api;

  const appsApi = {
    createNamespacedDeployment: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
  } as unknown as k8s.AppsV1Api;

  const networkingApi = {
    createNamespacedNetworkPolicy: vi.fn(async (a: { body: k8s.KubernetesObject }) => _record(a.body)),
  } as unknown as k8s.NetworkingV1Api;

  const customApi = {
    listNamespacedCustomObject: vi.fn(async () => ({ items: [] })),
    patchNamespacedCustomObjectStatus: vi.fn(async () => ({})),
  } as unknown as k8s.CustomObjectsApi;

  const statusPatches: Partial<TenantStatus>[] = [];
  const statusWriter = {
    patchStatus: vi.fn(async (_t: unknown, _ns: unknown, status: Partial<TenantStatus>) => { statusPatches.push(status); }),
  } as unknown as TenantStatusWriter;

  const encryptionKeys = { ensureEncryptionKeySecret: vi.fn(async () => {}) } as unknown as import("../../reconcilers/tenants/internal/tenant-encryption-keys.js").TenantEncryptionKeys;
  const liteLlmKeys = { ensureLiteLlmKeySecret: vi.fn(async () => {}) } as unknown as import("../../reconcilers/tenants/internal/tenant-litellm-keys.js").TenantLiteLlmKeys;
  const cogneeTenantIdentity = {
    ensureTenantCogneeIdentity: vi.fn(async () => {}),
    ensureTenantJoinedToSiloTenant: vi.fn(async () => {}),
  } as unknown as import("../../reconcilers/tenants/internal/cognee-tenant-identity.js").CogneeTenantIdentity;
  // Obot token minted successfully (ready) so this harness exercises the model gate, not the
  // fail-closed Obot path (#128).
  const obotToken = {
    ensureObotClientTokenSecret: vi.fn(async () => true),
    revokeAndDeleteObotClientToken: vi.fn(async () => {}),
  } as unknown as import("../../reconcilers/tenants/internal/tenant-obot-token.js").TenantObotToken;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = {} as any;
  const config = { ...defaultConfig, liteLlmEnabled: true };
  const op = new TenantOperator(
    stub, customApi, coreApi, appsApi, networkingApi, _log, config,
    onPremAdapter, stub, statusWriter, encryptionKeys, liteLlmKeys, cogneeTenantIdentity, obotToken, stub,
  );

  return { op, coreApi, appsApi, statusPatches, applied };
}

/** Build a good, LiteLLM-enabled ConfigMap to stand in as the "last-applied" one. */
function _goodConfigMap(): k8s.V1ConfigMap
{
  const config = { ...defaultConfig, liteLlmEnabled: true };
  const modelSet: TenantModelSet = { models: ["openai/gpt-5.5"], defaultModel: "openai/gpt-5.5" };
  return _BuildConfigMap(config, _makeTenant("acme"), "default", undefined, modelSet, "acme.opencrane.local");
}

describe("reconcileTenant fail-safe on empty/failed tenant-models (issue #144)", function _reconcileSuite()
{
  afterEach(function _restore() { vi.unstubAllGlobals(); });

  function _stubFetch(body: unknown, status = 200): void
  {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  }

  it("leaves the existing ConfigMap unchanged and marks Degraded on an empty fetch", async function _empty()
  {
    _stubFetch({ models: [], defaultModel: null });
    const good = _goodConfigMap();
    const { op, coreApi, appsApi, statusPatches } = _buildHarness({ existingConfigMap: good });

    await op.reconcileTenant(_makeTenant("acme", { phase: TenantStatusPhase.Running }));

    // The ConfigMap was NOT re-applied — the good one stays.
    expect(coreApi.createNamespacedConfigMap).not.toHaveBeenCalled();
    // The deployment is pinned to the EXISTING config's checksum, not a fresh model-less one.
    const deployment = (appsApi.createNamespacedDeployment as ReturnType<typeof vi.fn>).mock.calls[0][0].body as k8s.V1Deployment;
    const checksum = deployment.spec?.template.metadata?.annotations?.["opencrane.io/config-checksum"];
    expect(checksum).toBe(_ConfigChecksum(good));
    // Status is Degraded with the empty-set reason (not Error — the pod keeps serving).
    const last = statusPatches.at(-1)!;
    expect(last.phase).toBe(TenantStatusPhase.Degraded);
    expect(last.degradedReason).toBe(TenantDegradedReason.ModelSetEmpty);
    // observedGeneration is NOT stamped while degraded, so the next reconcile retries.
    expect(last.observedGeneration).toBeUndefined();
  });

  it("leaves the existing ConfigMap unchanged and marks Degraded on a failed fetch", async function _error()
  {
    _stubFetch("boom", 500);
    const good = _goodConfigMap();
    const { op, coreApi, statusPatches } = _buildHarness({ existingConfigMap: good });

    await op.reconcileTenant(_makeTenant("acme", { phase: TenantStatusPhase.Running }));

    expect(coreApi.createNamespacedConfigMap).not.toHaveBeenCalled();
    const last = statusPatches.at(-1)!;
    expect(last.phase).toBe(TenantStatusPhase.Degraded);
    expect(last.degradedReason).toBe(TenantDegradedReason.ModelFetchFailed);
  });

  it("renders normally and marks Running on a valid model set (regression)", async function _valid()
  {
    _stubFetch({ models: ["openai/gpt-5.5"], defaultModel: "openai/gpt-5.5" });
    const { op, coreApi, statusPatches, applied } = _buildHarness({ existingConfigMap: _goodConfigMap() });

    await op.reconcileTenant(_makeTenant("acme", { phase: TenantStatusPhase.Running }));

    // The ConfigMap WAS re-rendered and applied, carrying the prefixed default model.
    expect(coreApi.createNamespacedConfigMap).toHaveBeenCalledTimes(1);
    const openclaw = JSON.parse((applied["ConfigMap"][0] as k8s.V1ConfigMap).data?.["openclaw.json"] ?? "{}");
    expect(openclaw.agents.defaults.model).toBe("litellm-proxy/openai/gpt-5.5");
    const last = statusPatches.at(-1)!;
    expect(last.phase).toBe(TenantStatusPhase.Running);
    expect(last.degradedReason).toBeUndefined();
  });

  it("forcing observedGeneration:0 on a healthy tenant never downgrades the working model", async function _forcedReconcile()
  {
    // The elewa-be regression: a forced reconcile (observedGeneration reset) races an
    // empty/failed tenant-models read. The gate must keep the good config and NOT emit
    // a model-less one, so the working default survives the forced re-render.
    _stubFetch({ models: [], defaultModel: null });
    const good = _goodConfigMap();
    const { op, coreApi } = _buildHarness({ existingConfigMap: good });
    const tenant = _makeTenant("acme", { phase: TenantStatusPhase.Running });
    tenant.metadata!.generation = 5;
    tenant.status!.observedGeneration = 0; // forced re-reconcile

    await op.reconcileTenant(tenant);

    // No re-render: the good config (with its litellm-proxy default) is untouched.
    expect(coreApi.createNamespacedConfigMap).not.toHaveBeenCalled();
    const openclaw = JSON.parse(good.data?.["openclaw.json"] ?? "{}");
    expect(openclaw.agents.defaults.model).toBe("litellm-proxy/openai/gpt-5.5");
  });
});
