import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { _OperatorConfigChecksum, type OpenClawTenantOperatorConfig } from "../../app/config.js";
import { _BuildHostingAdapter, type HostingAdapter } from "../../hosting/index.js";

import type { Tenant } from "./models/tenant.types.js";
import { TenantPolicyResolutionState, TenantStatusPhase, type TenantDegradedReason } from "./models/tenant-status.interface.js";

import { __K8sApplyResource, _IsK8sNotFound, _RunWatchLoop, K8sWatchEventType, OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, TENANT_CRD_PLURAL, type ClusterTenantResource } from "@opencrane/infra/api";
import { _BuildOrgDomainProvisioner, type OrgDomainProvisioner } from "@opencrane/backend/cluster-tenants";
import { _BuildClusterTenantLimitRange, _BuildClusterTenantNamespace, _BuildClusterTenantResourceQuota, _BuildConfigMap, _BuildDeployment, _BuildGatewayNetworkPolicy, _BuildService, _BuildServiceAccount, _BuildSiloBaselineNetworkPolicy, _BuildSiloExternalEgressNetworkPolicy, _BuildSiloKubernetesApiEgressNetworkPolicy, _BuildSiloLinkerdIdentityPolicy, _BuildStatePvc, _ConfigChecksum, _ResolveTenantModelGate } from "./deploy/index.js";
import { TenantCleanup } from "./destroy/tenant-cleanup.js";
import { LinkerdIdentityClient } from "./internal/linkerd-identity.client.js";

import { TenantEncryptionKeys } from "./internal/tenant-encryption-keys.js";
import { TenantLiteLlmKeys } from "./internal/tenant-litellm-keys.js";
import { CogneeTenantIdentity } from "./internal/cognee-tenant-identity.js";
import { _ResolveTenantPolicy } from "./internal/policy-resolution.js";
import { _FetchTenantModels } from "./internal/tenant-models.js";
import { _ResolveClusterTenant } from "./internal/cluster-tenant-resolution.js";
import { _ResolveOrgServingDomain } from "./internal/org-serving-domain.js";
import { TenantStatusWriter } from "./internal/tenant-status-writer.js";

/**
 * Watches Tenant custom resources and reconciles the corresponding
 * Kubernetes workloads.
 *
 * All dependencies are injected via the constructor — use
 * {@link _CreateTenantOperator} to assemble from a raw KubeConfig in
 * production entry-points, and pass mocks directly in tests.
 */
export class TenantOperator
{
  /** Watch client for streaming Tenant CR events. */
  private watch: k8s.Watch;

  /** Client for custom resources (AccessPolicy, status subresource). */
  private customApi: k8s.CustomObjectsApi;

  /** Client for CoreV1 resources (ServiceAccount, Secret, ConfigMap, Service, PVC). */
  private coreApi: k8s.CoreV1Api;

  /** Client for AppsV1 resources (Deployment). */
  private appsApi: k8s.AppsV1Api;

  /** Client for NetworkingV1 resources (Ingress). */
  private networkingApi: k8s.NetworkingV1Api;

  /** Scoped logger for tenant-operator messages. */
  private log: Logger;

  /** Operator runtime configuration loaded from environment. */
  private config: OpenClawTenantOperatorConfig;

  /** Hosting adapter — provides cloud-specific storage, identity, and ingress behaviour. */
  private hosting: HostingAdapter;

  /** Helper for removing tenant-owned resources during delete flows. */
  private cleanup: TenantCleanup;

  /** Helper for patching Tenant status subresource. */
  private statusWriter: TenantStatusWriter;

  /** Helper for per-tenant AES encryption key Secret lifecycle. */
  private encryptionKeys: TenantEncryptionKeys;

  /** Helper for LiteLLM virtual key provisioning and Secret creation. */
  private liteLlmKeys: TenantLiteLlmKeys;

  /** Helper for provisioning a real, per-tenant Cognee login (never a shared default). */
  private cogneeTenantIdentity: CogneeTenantIdentity;

  /**
   * Per-org DNS/vanity-TLS provisioner (#151 item 2). Invoked from
   * {@link enforceClusterTenantIsolation} ONLY when `config.manageOwnDomain` is true
   * (standalone: no external fleet to own the org's domain); a no-op reference is still
   * wired in fleet-managed mode, but never called.
   */
  private domainProvisioner: OrgDomainProvisioner;

  /**
   * Per-tenant reconcile coalescing. The watch runner dispatches handlers fire-and-forget,
   * so a watch reconnect replays every Tenant as `ADDED` at once, and a persistently failing
   * reconcile (e.g. a quota 403) re-triggers itself via its own `Error` status write. Without
   * a guard those reconciles run concurrently and unbounded — hammering the API and churning
   * downstream accounting (ResourceQuota `used`). `running` holds names with a drain loop in
   * progress; `pending` holds the latest Tenant awaiting reconcile per name. An event for a
   * name already running only updates `pending` (coalesced — reconcile is idempotent), so
   * in-flight work is bounded to one reconcile per tenant. Mirrors ClusterTenantOperator.
   */
  private readonly running = new Set<string>();

  /** Latest Tenant awaiting reconcile per name (see {@link running}). */
  private readonly pending = new Map<string, Tenant>();

  /**
   * Checksum of the operator's OWN config, computed once at construction. Stamped on each
   * tenant's `Running` status as `observedConfigChecksum`; the reconcile guard skips a
   * converged tenant only when its stamped checksum still matches this value, so a
   * `helm upgrade` that changes operator config re-arms a full reconcile of every tenant
   * without a manual restart or per-tenant spec edit (the operator-input analogue of the
   * tenant-pod config-checksum roll).
   */
  private readonly configChecksum: string;

  /** Delay between failed startup snapshot attempts. */
  private readonly initialReplayRetryDelayMs: number;

  /**
   * Create a new TenantOperator with pre-wired dependencies.
   * Prefer {@link _CreateTenantOperator} in production entry-points.
   */
  constructor(watch: k8s.Watch,
              customApi: k8s.CustomObjectsApi,
              coreApi: k8s.CoreV1Api,
              appsApi: k8s.AppsV1Api,
              networkingApi: k8s.NetworkingV1Api,
              log: Logger,
              config: OpenClawTenantOperatorConfig,
              hosting: HostingAdapter,
              cleanup: TenantCleanup,
              statusWriter: TenantStatusWriter,
              encryptionKeys: TenantEncryptionKeys,
              liteLlmKeys: TenantLiteLlmKeys,
              cogneeTenantIdentity: CogneeTenantIdentity,
              domainProvisioner: OrgDomainProvisioner,
              initialReplayRetryDelayMs = 5000)
  {
    this.watch = watch;
    this.customApi = customApi;
    this.coreApi = coreApi;
    this.appsApi = appsApi;
    this.networkingApi = networkingApi;
    this.log = log;
    this.config = config;
    this.hosting = hosting;
    this.cleanup = cleanup;
    this.statusWriter = statusWriter;
    this.encryptionKeys = encryptionKeys;
    this.liteLlmKeys = liteLlmKeys;
    this.cogneeTenantIdentity = cogneeTenantIdentity;
    this.domainProvisioner = domainProvisioner;
    this.configChecksum = _OperatorConfigChecksum(config);
    this.initialReplayRetryDelayMs = initialReplayRetryDelayMs;
  }

  /**
   * Begin watching for Tenant CR events and reconcile on each change.
   * Automatically reconnects on watch errors with a 5-second backoff.
   */
  async start(): Promise<void>
  {
    const ns = this.config.watchNamespace;
    const path = ns
      ? `/apis/${OPENCRANE_API_GROUP}/${OPENCRANE_API_VERSION}/namespaces/${ns}/${TENANT_CRD_PLURAL}`
      : `/apis/${OPENCRANE_API_GROUP}/${OPENCRANE_API_VERSION}/${TENANT_CRD_PLURAL}`;

    await _RunWatchLoop<Tenant>({
      watch: this.watch,
      path,
      log: this.log,
      startMessage: "starting tenant watch",
      reconnectMessage: "watch connection lost, reconnecting...",
      failedMessage: "watch failed, retrying...",
      onEvent: async (type: K8sWatchEventType | string, tenant: Tenant) => {
        await this.handleEvent(type, tenant);
      },
    });
    await this.reconcileExistingTenantsUntilListed();
  }

  /**
   * Fetch an existing Tenant CR and route it through the same coalesced reconcile path
   * as an ADDED watch event.
   *
   * Standalone boot seeds create the first Tenant from inside this process, before
   * Kubernetes watch delivery is guaranteed. This gives the seeding path a deterministic
   * hand-off while the startup replay remains the backstop after restarts.
   */
  async reconcileExistingTenantByName(name: string, namespace: string): Promise<void>
  {
    const tenant = await this.customApi.getNamespacedCustomObject({
      group: OPENCRANE_API_GROUP,
      version: OPENCRANE_API_VERSION,
      namespace,
      plural: TENANT_CRD_PLURAL,
      name,
    }) as Tenant;
    await this.handleEvent(K8sWatchEventType.Added, tenant);
  }

  /**
   * Retry the startup snapshot until the current Tenant set has been listed.
   *
   * The watch remains active while this waits; the retry only closes transient
   * list failures that would otherwise leave pre-existing Tenant CRs invisible.
   */
  private async reconcileExistingTenantsUntilListed(): Promise<void>
  {
    while (true)
    {
      const listed = await this.reconcileExistingTenants();
      if (listed) return;

      const retryDelayMs = this.initialReplayRetryDelayMs;
      await new Promise<void>(function _sleep(resolve)
      {
        setTimeout(resolve, retryDelayMs);
      });
    }
  }

  /**
   * Reconcile Tenant CRs that already existed before the watch stream connected.
   *
   * Kubernetes watches observe changes after the stream starts; they are not an
   * initial snapshot. Boot seeds and operator restarts can therefore leave a
   * Tenant present but unreconciled unless startup also lists the current set.
   */
  private async reconcileExistingTenants(): Promise<boolean>
  {
    try
    {
      const ns = this.config.watchNamespace;
      const response = ns
        ? await this.customApi.listNamespacedCustomObject({ group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, namespace: ns, plural: TENANT_CRD_PLURAL })
        : await this.customApi.listClusterCustomObject({ group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: TENANT_CRD_PLURAL });
      const tenants = (response as { items?: Tenant[] }).items ?? [];
      this.log.info({ count: tenants.length }, "replaying existing tenants before watch settles");

      for (const tenant of tenants)
      {
        try
        {
          await this.handleEvent(K8sWatchEventType.Added, tenant);
        }
        catch (err)
        {
          this.log.error({ err, name: tenant.metadata?.name }, "initial tenant reconcile failed");
        }
      }
    }
    catch (err)
    {
      this.log.error({ err }, "initial tenant replay failed; retrying while watch remains active");
      return false;
    }
    return true;
  }

  /**
   * Route a watch event to the appropriate reconciliation handler.
   */
  private async handleEvent(type: K8sWatchEventType | string, tenant: Tenant): Promise<void>
  {
    const name = tenant.metadata?.name;
    if (!name) return;

    this.log.info({ type, name }, "tenant event");

    switch (type)
    {
      case K8sWatchEventType.Added:
      case K8sWatchEventType.Modified:
        await this.dispatchReconcile(tenant);
        break;
      case K8sWatchEventType.Deleted:
        // Drop any queued reconcile first so a coalesced event cannot re-create what we tear down.
        this.pending.delete(name);
        await this.cleanupTenant(tenant);
        break;
    }
  }

  /**
   * Dispatch a Tenant event through the per-tenant coalescing guard (see {@link running}).
   *
   * Records the Tenant as the latest desired state, then — unless a drain loop is already
   * running for that name — drains `pending` to convergence one reconcile at a time. This
   * serialises reconciles per tenant and bounds concurrent work to one-per-tenant, so a
   * watch-reconnect storm or a self-retriggering failed reconcile can never accumulate
   * fire-and-forget handlers (which would hammer the API and churn ResourceQuota accounting).
   * The suspended/active branch is re-evaluated against the newest pending state each drain.
   *
   * @param tenant - The Tenant from the watch event.
   */
  private async dispatchReconcile(tenant: Tenant): Promise<void>
  {
    const name = tenant.metadata?.name;
    if (!name) return;

    this.pending.set(name, tenant);
    if (this.running.has(name)) return;

    this.running.add(name);
    try
    {
      while (this.pending.has(name))
      {
        const next = this.pending.get(name)!;
        this.pending.delete(name);
        if (next.spec.suspended)
        {
          await this.suspendTenant(next);
        }
        else
        {
          await this.reconcileTenant(next);
        }
      }
    }
    finally
    {
      this.running.delete(name);
    }
  }

  /**
   * Reconcile all child resources for a running tenant and update status.
   *
   * Reconciliation is idempotent: it can be called repeatedly on the same
   * Tenant CR and will converge to the desired state without side effects.
   * Each child resource is applied via server-side apply, so existing
   * resources are updated in-place and missing ones are created.
   *
   * The reconcile order matters: later resources depend on earlier ones.
   * ServiceAccount must exist before the Deployment can reference it;
   * the encryption key Secret must exist before the Deployment mounts it;
   * the ConfigMap must exist before the Deployment reads it.
   *
   * On any failure the error is caught, `status.phase` is set to `"Error"`
   * with the error message, and the error is re-thrown so the watch loop
   * logs it and the event is not silently swallowed.
   */
  async reconcileTenant(tenant: Tenant): Promise<void>
  {
    const name = tenant.metadata!.name!;

    // The Tenant CR itself always lives in its own namespace; status patches must
    // target that namespace regardless of where child resources are deployed.
    const crNamespace = tenant.metadata!.namespace ?? "default";

    // Skip the full redeploy when an already-Running Tenant's spec is unchanged AND the
    // operator config it was reconciled under is unchanged — the watch-replay case.
    // `metadata.generation` bumps only on a spec change (status writes do not), so a
    // converged Tenant has `observedGeneration === generation`. Without this, every watch
    // event (including the operator's OWN status writes) re-runs the entire reconcile, and a
    // persistently failing one (e.g. a quota 403) self-loops via its Error status write.
    // The config-checksum arm forces a full re-reconcile after a `helm upgrade` changed
    // operator config (the operator-input analogue of the tenant-pod config-checksum roll):
    // `generation` only tracks the tenant's own spec, so without it an operator-config change
    // would never reach existing tenants. A Tenant with no generation still reconciles, then
    // stamps both below.
    const generation = tenant.metadata?.generation;
    if (tenant.status?.phase === TenantStatusPhase.Running
        && typeof generation === "number"
        && tenant.status?.observedGeneration === generation
        && tenant.status?.observedConfigChecksum === this.configChecksum)
    {
      this.log.debug({ name, generation }, "tenant already reconciled at this generation and config; skipping");
      return;
    }

    this.log.info({ name, provider: this.hosting.provider }, "reconciling tenant");

    try
    {
      // 0a. Parent ClusterTenant — resolve the deployment target namespace. Ref-less
      //     openclaws stay on the install namespace (byte-for-byte unchanged); a ref'd
      //     openclaw lands in the parent's bound namespace (opt-in multi-tenancy).
      const clusterTenantResolution = await _ResolveClusterTenant(this.customApi, tenant, crNamespace);
      const namespace = clusterTenantResolution.targetNamespace;
      if (clusterTenantResolution.ref && clusterTenantResolution.clusterTenant)
      {
        this.log.info({ name, clusterTenantRef: tenant.spec.clusterTenantRef, namespace }, "openclaw attached to cluster tenant");
        // 0a-i. Native isolation — fence the customer's namespace before any child
        //       resource lands in it. Ref-less openclaws skip this block entirely so
        //       the default (single-install) path stays byte-for-byte unchanged.
        await this.enforceClusterTenantIsolation(clusterTenantResolution.clusterTenant, namespace);
      }
      const compute = clusterTenantResolution.clusterTenant?.spec.compute;
      // Fixed-wildcard topology — resolve the org's SINGLE serving host under the platform
      // wildcard base (`config.ingressDomain`). An org (ClusterTenant) is served at its
      // DERIVED apex `<org>.<base>`; every user connects through that one host and the
      // in-process gateway proxy routes each connection to the right pod (NO per-user
      // subdomains). `_ResolveOrgServingDomain` also lets a customer-vanity domain (CNAMEd
      // onto the apex) override it. Ref-less openclaws have no parent org → they stay at the
      // bare `<base>` per-instance host, so the default path is unchanged.
      const ingressDomain = _ResolveOrgServingDomain(
        clusterTenantResolution.clusterTenant?.metadata?.name,
        clusterTenantResolution.clusterTenant?.spec.vanityDomain,
        this.config.ingressDomain,
      );

      // 0b. Effective policy — resolve policyRef deterministically so runtime behavior
      //    is predictable even when selectors or default policies are configured.
      const policyResolution = await _ResolveTenantPolicy(this.customApi, this.config, tenant, namespace);
      const effectivePolicyRef = policyResolution.effectivePolicy?.metadata?.name;
      if (policyResolution.state === TenantPolicyResolutionState.PolicyNotFound
        || policyResolution.state === TenantPolicyResolutionState.PolicyConflict
        || policyResolution.state === TenantPolicyResolutionState.DefaultPolicyNotFound)
      {
        await this.statusWriter.patchStatus(tenant, crNamespace, {
          phase: TenantStatusPhase.Error,
          message: policyResolution.message,
          effectivePolicyRef,
          policyResolutionSource: policyResolution.source,
          policyResolutionState: policyResolution.state,
          lastReconciled: new Date().toISOString(),
        });
        throw new Error(policyResolution.message);
      }

      const effectiveTenant: Tenant = {
        ...tenant,
        spec: {
          ...tenant.spec,
          policyRef: effectivePolicyRef,
        },
      };

      // 0c. Allowed model set — best-effort fetch of the tenant's registered models
      //     from the opencrane-ui internal API. This is a deliberate, non-fatal
      //     operator → opencrane-ui dependency: it never throws. The fetch reports
      //     ok / empty / error so step 5 can refuse to clobber a good config with a
      //     model-less one on a transient empty/failed read (issue #144).
      const modelFetch = await _FetchTenantModels(this.config.controlPlaneInternalUrl, name, this.log);
      const modelSet = modelFetch.modelSet;

      // 1. ServiceAccount — identity annotations come from the adapter; empty on-prem,
      //    Workload Identity annotation on GKE, IRSA on EKS, etc.
      await __K8sApplyResource(this.coreApi, _BuildServiceAccount(this.hosting, effectiveTenant, namespace), this.log);

      // 2. External storage — provision per-cloud via the adapter SDK (GCS bucket etc).
      //    No-op on-prem; idempotent so safe to call on every reconcile.
      await this.hosting.provisionTenantStorage({ tenantName: name, namespace });

      // 3. Encryption key Secret — generates a random 32-byte AES key on first reconcile
      //    and stores it as a K8s Secret. Idempotent: existing secrets are not rotated.
      await this.encryptionKeys.ensureEncryptionKeySecret(name, namespace);

      // 4. LiteLLM key Secret — creates a per-tenant virtual key in LiteLLM and stores
      //    it in a tenant Secret mounted through env var. Skipped when LiteLLM is disabled.
      //    Best-effort so transient LiteLLM backend issues do not block tenant startup.
      try
      {
        await this.liteLlmKeys.ensureLiteLlmKeySecret(effectiveTenant, namespace, modelSet);
      }
      catch (err)
      {
        this.log.warn({ err, name }, "litellm key provisioning failed; continuing reconcile");
      }

      // 5. Cognee tenant identity — registers a REAL Cognee user account for this tenant
      //    (the same owner email the gateway's trusted-proxy allowlist already pins the pod
      //    to), so the pod authenticates to Cognee as ITSELF rather than the plugin's
      //    hardcoded default_user fallback. Best-effort so a Cognee outage does not block
      //    tenant startup (memory is a dependency, not a hard requirement). Skipped when
      //    Cognee is not configured for this silo.
      try
      {
        await this.cogneeTenantIdentity.ensureTenantCogneeIdentity(effectiveTenant, namespace);
      }
      catch (err)
      {
        this.log.warn({ err, name }, "cognee tenant identity provisioning failed; continuing reconcile");
      }

      // 5b. Join that login to the silo's shared Cognee Tenant (see CogneeSiloTenant), so the
      //     plugin's companyDataset scope is actually shared across every openclaw tenant in
      //     this silo instead of becoming a private dataset per tenant. Independent try/catch:
      //     a failure here must not block step 5's login from having already been created, and
      //     is itself retried on the next reconcile regardless of this one's outcome.
      try
      {
        await this.cogneeTenantIdentity.ensureTenantJoinedToSiloTenant(effectiveTenant, namespace);
      }
      catch (err)
      {
        this.log.warn({ err, name }, "cognee silo-tenant join failed; continuing reconcile");
      }

      // 5c. Capture the tenant's current Cognee silo-tenant id (best-effort) so step 8 can stamp it
      //     on the pod template. A server-side Cognee identity heal (silo re-provisioned, or a wiped
      //     login re-registered + re-joined above) changes this id; the running pod caches its
      //     Cognee session and never re-logins on a 401, so without this stamp it stays 401 until
      //     something else happens to roll it. Empty string when Cognee is off / not joined yet.
      let cogneeIdentityStamp = "";
      if (this.config.cogneeEndpoint)
      {
        try
        {
          cogneeIdentityStamp = await this.cogneeTenantIdentity.currentJoinedTenantId(name, namespace);
        }
        catch (err)
        {
          this.log.warn({ err, name }, "reading cognee identity stamp failed; pod roll on identity change skipped this cycle");
        }
      }

      // 6. ConfigMap — serialises the platform-owned OpenClaw JSON config. Capture it so its
      //    checksum can roll the pod when the config changes (step 7).
      //
      //    FAIL-SAFE (issue #144): when LiteLLM is enabled the config's model set comes
      //    from the live `tenant-models` read; an empty/failed read would render a
      //    model-less config and openclaw would fall back to the keyless built-in
      //    provider (missing-provider-auth). The gate refuses to re-render over an
      //    already-applied config in that case — it keeps the last-applied ConfigMap and
      //    marks the tenant Degraded — while a first-ever provision still renders.
      //
      //    The existing ConfigMap is only read when it could change the decision (LiteLLM
      //    on AND the fetch was not clean-ok); on the happy path the gate is `render`
      //    regardless, so the extra API read is skipped.
      const needsExistingConfigMap = this.config.liteLlmEnabled && modelFetch.status !== "ok";
      const existingConfigMap = needsExistingConfigMap ? await this.readExistingConfigMap(name, namespace) : null;
      const modelGate = _ResolveTenantModelGate(modelFetch.status, this.config.liteLlmEnabled, existingConfigMap !== null);

      let configChecksum: string;
      let degradedReason: TenantDegradedReason | undefined;
      let degradedMessage: string | undefined;
      if (modelGate.action === "skip-degraded")
      {
        // Keep the last-applied ConfigMap untouched and pin the pod template to ITS
        // checksum so the deployment does not roll onto a config we deliberately did not
        // write. The condition is surfaced on the CR in step 10.
        this.log.warn({ name, reason: modelGate.reason }, modelGate.message);
        degradedReason = modelGate.reason;
        degradedMessage = modelGate.message;
        configChecksum = _ConfigChecksum(existingConfigMap!);
      }
      else
      {
        const configMap = _BuildConfigMap(this.config, effectiveTenant, namespace, policyResolution.effectivePolicy, modelSet, ingressDomain);
        await __K8sApplyResource(this.coreApi, configMap, this.log);
        // Checksum of the rendered config — stamped on the pod template so a config
        // change (e.g. a newly-registered BYOK default model landing in openclaw.json)
        // rolls the pod. Without this, a mounted ConfigMap update never restarts the
        // running OpenClaw process, which reads openclaw.json only at startup — so a
        // pod that booted before its models existed stays on the keyless fallback.
        configChecksum = _ConfigChecksum(configMap);
      }

      // 7. State volume — adapter decides CSI mount (cloud) vs PVC (on-prem).
      //    Create the PVC only when the adapter requests it (on-prem path).
      const stateVolume = this.hosting.buildStateVolume(name);
      if (stateVolume.requiresPvc)
      {
        await __K8sApplyResource(this.coreApi, _BuildStatePvc(name, namespace, this.config.tenantStorageClassName), this.log);
      }

      // 8. Deployment — single-replica pod running the tenant's OpenClaw gateway.
      //    Mounts the ConfigMap, encryption key, state volume, and projected identity tokens.
      await __K8sApplyResource(this.appsApi, _BuildDeployment(this.config, stateVolume, effectiveTenant, namespace, compute, configChecksum, cogneeIdentityStamp), this.log);

      // 9. Service — ClusterIP that makes the gateway reachable inside the cluster
      //    on the configured gateway port.
      await __K8sApplyResource(this.coreApi, _BuildService(this.config, effectiveTenant, namespace), this.log);

      // 10. NetworkPolicy — lock the gateway port to the identity-routing proxy (now folded
      //    into the operator) so the trusted-proxy auth (CONN.4) can't be abused by other
      //    in-cluster pods. No per-user Ingress is minted: every user reaches their pod
      //    through the org's single host `<org>.<base>`, reverse-proxied by the operator to
      //    this pod's Service. The org host is served by the platform wildcard Ingress +
      //    cert and gets an explicit external-dns record (see the org-domain provisioner).
      await __K8sApplyResource(this.networkingApi, _BuildGatewayNetworkPolicy(this.config, effectiveTenant, namespace), this.log);

      // 11. Status — write the observed state back to the Tenant CR so that kubectl, the
      //    opencrane-ui API, and the UI all see the current phase. When the model gate
      //    skipped the ConfigMap refresh the pod is still serving on its last-applied
      //    (good) config, so the phase is Degraded (not Error) with the reason recorded;
      //    otherwise Running with any stale reason cleared. observedGeneration is NOT
      //    stamped when degraded so the next reconcile retries the model fetch rather than
      //    being short-circuited by the generation guard — the requeue that self-heals it.
      await this.statusWriter.patchStatus(tenant, crNamespace, {
        phase: degradedReason ? TenantStatusPhase.Degraded : TenantStatusPhase.Running,
        message: degradedMessage,
        degradedReason,
        podName: `openclaw-${name}`,
        // Served at the ORG host (`<org>.<base>` or vanity) via the proxy — no per-user subdomain.
        ingressHost: ingressDomain,
        effectivePolicyRef,
        policyResolutionSource: policyResolution.source,
        policyResolutionState: policyResolution.state,
        lastReconciled: new Date().toISOString(),
        // Record the generation we converged so the guard at the top of reconcileTenant
        // skips the next watch replay of this unchanged Tenant. A spec edit bumps generation
        // and re-arms a full reconcile. Left UNSET while degraded so the fetch is retried.
        observedGeneration: degradedReason ? undefined : tenant.metadata?.generation,
        // Record the operator config we converged under so the same guard re-arms a full
        // reconcile after a `helm upgrade` changes operator config. Left UNSET while degraded
        // alongside observedGeneration so the guard never short-circuits the fetch retry.
        observedConfigChecksum: degradedReason ? undefined : this.configChecksum,
      });
    }
    catch (err)
    {
      this.log.error({ err, name }, "reconcile failed");
      await this.statusWriter.patchStatus(tenant, crNamespace, {
        phase: TenantStatusPhase.Error,
        message: err instanceof Error ? err.message : String(err),
        lastReconciled: new Date().toISOString(),
      });
      throw err;
    }
  }

  /**
   * Read the tenant's currently-applied openclaw ConfigMap, if any.
   *
   * Used by the model gate (issue #144) to tell a first-ever provision (nothing to
   * protect — render the temporarily model-less config) apart from a re-reconcile over
   * an already-good config (keep it, mark Degraded). A confirmed 404 means "no ConfigMap
   * yet" → `null`. Any OTHER read error is inconclusive: we must NOT assume absence, or a
   * transient API blip could let an empty/failed model fetch clobber a working config, so
   * it is re-thrown to fail the reconcile into a retry rather than resolved to `null`.
   *
   * @param name - Tenant CR name (the ConfigMap is `openclaw-<name>-config`).
   * @param namespace - Namespace the tenant's child resources live in.
   */
  private async readExistingConfigMap(name: string, namespace: string): Promise<k8s.V1ConfigMap | null>
  {
    try
    {
      return await this.coreApi.readNamespacedConfigMap({ name: `openclaw-${name}-config`, namespace });
    }
    catch (err)
    {
      if (_IsK8sNotFound(err))
      {
        return null;
      }
      throw err;
    }
  }

  /**
   * Provision and fence the per-ClusterTenant namespace for the opt-in
   * multi-tenant path.
   *
   * This is only reached when an openclaw references a ClusterTenant; it
   * ensures the customer's namespace exists with PSA `restricted` enforcement,
   * stamps an aggregate ResourceQuota derived from the customer's quota, and
   * lays down a default LimitRange so quota-constrained pods still schedule.
   * Live PSA/quota enforcement is the cluster seam; here we converge the
   * objects idempotently via server-side create-or-replace.
   *
   * @param clusterTenant - Resolved parent ClusterTenant carrying quota/compute.
   * @param namespace - The customer's bound namespace to fence.
   */
  private async enforceClusterTenantIsolation(clusterTenant: ClusterTenantResource, namespace: string): Promise<void>
  {
    const clusterTenantName = clusterTenant.metadata?.name ?? namespace;

    // 1. Namespace — ensure the fenced namespace exists and carries the PSA
    //    baseline enforce/warn/audit labels before any workload lands in it. When the
    //    Linkerd gate is on (S5) it is also annotated for mesh injection so workloads
    //    pick up the sidecar/identity; the annotation is inert on a Linkerd-less cluster.
    //
    //    Ownership is explicit (not inferred from a 403): in the fleet-managed topology the
    //    fleet-manager creates and owns each org's namespace and the silo SA holds NO
    //    cluster-scoped `namespaces` RBAC, so the silo must SKIP the create entirely — it is
    //    `manageTenantNamespaces=false`. Only an all-in-one / standalone silo that has been
    //    granted the gated namespace-management ClusterRole sets the flag true and creates it.
    //    Either way, a genuinely-absent namespace still surfaces below: the baseline
    //    NetworkPolicy + quota applies target this namespace and fail NotFound if it is missing.
    if (this.config.manageTenantNamespaces)
    {
      await __K8sApplyResource(this.coreApi, _BuildClusterTenantNamespace(namespace, clusterTenantName, this.config.linkerdMeshEnabled), this.log);
    }
    else
    {
      this.log.debug({ namespace, clusterTenant: clusterTenantName }, "manageTenantNamespaces=false: skipping namespace create (fleet-manager owns it)");
    }

    // 1b. Kubernetes API egress — scoped to in-silo control-plane pods only. In
    //     standalone installs the operator runs inside the same namespace it fences;
    //     lay down this API path BEFORE the namespace-wide default-deny below so the
    //     operator can still finish the rest of reconcile. Fleet-managed silos use a
    //     separate tenant namespace, so the external fleet/operator namespace keeps
    //     its own platform policy and no runtime carve-out is needed here.
    if (namespace === this.config.operatorNamespace)
    {
      await __K8sApplyResource(this.networkingApi, _BuildSiloKubernetesApiEgressNetworkPolicy(namespace, clusterTenantName), this.log);
    }

    // 1b-2. Silo baseline NetworkPolicy — flip the namespace to default-deny (S2 /
    //     Phase 1) right after it exists and before any workload lands, so the silo
    //     edge is closed from the start: only intra-silo + the opencrane-ui plane
    //     and DNS are allowed; no silo→silo path is ever created.
    await __K8sApplyResource(this.networkingApi, _BuildSiloBaselineNetworkPolicy(namespace, clusterTenantName, this.config), this.log);

    // 1b-3. External-HTTPS egress — a SEPARATE policy from the baseline above (see its
    //       doc comment) so the bundled Cognee pod can be excluded from it. An
    //       unpatched Cognee vuln (topoteretes/cognee#3084) lets any authenticated
    //       Cognee user redirect its process-wide LLM endpoint with no admin check;
    //       without this exclusion Cognee could exfiltrate the silo's data to an
    //       attacker-controlled host the moment that's exploited.
    await __K8sApplyResource(this.networkingApi, _BuildSiloExternalEgressNetworkPolicy(namespace, clusterTenantName), this.log);

    // 1c. Linkerd identity layer (S5 / ADR 0001) — gated OFF by default. When on, lay
    //     the meshed mTLS-identity analogue of the S2 baseline ON TOP of the L3/4 floor:
    //     a deny-by-default Server + a MeshTLSAuthentication allow-list (intra-silo + the
    //     operator plane only) + the AuthorizationPolicy binding them. Applied as untyped
    //     CRs; the client fails closed (logs + skips) if Linkerd's CRDs are absent, so
    //     enabling the gate on a Linkerd-less cluster is a safe no-op, not a wedged reconcile.
    if (this.config.linkerdMeshEnabled)
    {
      const linkerdClient = new LinkerdIdentityClient(this.customApi, this.log);
      const bundle = _BuildSiloLinkerdIdentityPolicy(namespace, clusterTenantName, this.config);
      const { applied } = await linkerdClient.applySiloIdentityPolicy(namespace, bundle);
      if (!applied)
      {
        this.log.warn({ namespace, clusterTenant: clusterTenantName }, "Linkerd identity policy skipped (CRDs absent); silo isolated at L3/4 only");
      }
    }

    // 2. ResourceQuota — cap the customer's aggregate CPU/memory/pods/storage/GPU
    //    so a single customer cannot starve the cluster. Only stamped when the
    //    ClusterTenant actually declared a quota block.
    const quota = clusterTenant.spec.resources?.quota;
    if (quota)
    {
      await __K8sApplyResource(this.coreApi, _BuildClusterTenantResourceQuota(namespace, clusterTenantName, quota), this.log);

      // 3. LimitRange — a quota over requests.* rejects pods that omit requests;
      //    supply per-container defaults so unannotated workloads still schedule.
      await __K8sApplyResource(this.coreApi, _BuildClusterTenantLimitRange(namespace, clusterTenantName), this.log);
    }

    // 4. Org domain (DNS + vanity TLS) provisioning — STANDALONE ONLY (#151 item 2). In the
    //    fleet-managed topology the external fleet's own ClusterTenantOperator already calls
    //    the equivalent provisioner against its own CR watch, so this silo must stay a no-op
    //    here or the two planes would double-apply (and disagree on ownership) the same
    //    DNSEndpoint/Certificate. `manageOwnDomain` defaults to the same standalone signal as
    //    `manageTenantNamespaces` (FLEET_INTERNAL_URL unset). Best-effort: the provisioner
    //    itself never throws (fail-closed skip on absent cert-manager/external-dns), but the
    //    call is still wrapped so an unexpected error never blocks the tenant pod from coming
    //    up — the namespace boundary, not the domain record, is the openclaw-attachment gate.
    if (this.config.manageOwnDomain)
    {
      try
      {
        const domain = await this.domainProvisioner.provisionOrgDomain({
          orgName: clusterTenantName,
          boundNamespace: namespace,
          platformBaseDomain: this.config.ingressDomain,
          vanityDomain: clusterTenant.spec.vanityDomain,
          ingressIp: this.config.ingressIp || undefined,
        });
        if (domain.skipped)
        {
          this.log.warn({ namespace, clusterTenant: clusterTenantName, message: domain.message }, "org domain provisioning skipped (cert-manager/external-dns absent)");
        }
        else if (!domain.ready)
        {
          this.log.info({ namespace, clusterTenant: clusterTenantName, message: domain.message }, "org domain still settling");
        }
      }
      catch (err)
      {
        this.log.warn({ err, namespace, clusterTenant: clusterTenantName }, "org domain provisioning failed; continuing reconcile");
      }
    }
  }

  /**
   * Suspend a tenant by scaling the deployment to zero replicas.
   */
  private async suspendTenant(tenant: Tenant): Promise<void>
  {
    const name = tenant.metadata!.name!;

    // The Tenant CR lives in its own namespace; status patches target it
    // regardless of where the (suspended) Deployment is rebuilt.
    const crNamespace = tenant.metadata!.namespace ?? "default";

    // Skip when this tenant is already Suspended at the current generation — the
    // self-loop case. Writing the Suspended status below fires a Modified watch event,
    // which re-dispatches; because `spec.suspended` is still true it routes back here,
    // and without this guard suspendTenant re-runs on its OWN status write forever
    // (churning the API with 409s). Mirrors the reconcileTenant generation guard: a
    // status write does not bump `metadata.generation`, so an unchanged suspended Tenant
    // has `observedGeneration === generation`. A spec edit (e.g. un-suspend) bumps
    // generation and re-arms the suspend/reconcile branch. This path never sets Degraded,
    // so it does not interact with #144's degraded-retry (observedGeneration stays set).
    const generation = tenant.metadata?.generation;
    if (tenant.status?.phase === TenantStatusPhase.Suspended
        && typeof generation === "number"
        && tenant.status?.observedGeneration === generation)
    {
      this.log.debug({ name, generation }, "tenant already suspended at this generation; skipping");
      return;
    }

    this.log.info({ name }, "suspending tenant");

    // 1. Resolve the parent ClusterTenant so the suspended Deployment is rebuilt in
    //    the same namespace and with the same compute placement as the live one;
    //    ref-less openclaws resolve to the install namespace + no compute, so the
    //    default (single-install) path stays byte-for-byte unchanged.
    const clusterTenantResolution = await _ResolveClusterTenant(this.customApi, tenant, crNamespace);
    const namespace = clusterTenantResolution.targetNamespace;
    const compute = clusterTenantResolution.clusterTenant?.spec.compute;

    // 2. Rebuild the Deployment identically but scaled to zero so the pod stops
    //    without losing its namespace or scheduling identity.
    const stateVolume = this.hosting.buildStateVolume(name);
    const deployment = _BuildDeployment(this.config, stateVolume, tenant, namespace, compute);
    deployment.spec!.replicas = 0;
    await __K8sApplyResource(this.appsApi, deployment, this.log);

    // 3. Record the suspended phase against the CR namespace. Stamp observedGeneration so
    //    the guard above short-circuits the Modified event this write triggers — the
    //    self-loop breaker. A spec edit (bumping generation) re-arms the branch.
    await this.statusWriter.patchStatus(tenant, crNamespace, {
      phase: TenantStatusPhase.Suspended,
      lastReconciled: new Date().toISOString(),
      observedGeneration: tenant.metadata?.generation,
    });
  }

  /**
   * Remove child resources for a deleted tenant.
   * Retains: external storage bucket and encryption key Secret.
   */
  private async cleanupTenant(tenant: Tenant): Promise<void>
  {
    const name = tenant.metadata!.name!;
    const namespace = tenant.metadata!.namespace ?? "default";

    this.log.info({ name }, "cleaning up tenant resources");

    await this.cleanup.cleanupTenant(name, namespace);

    this.log.info({ name }, "tenant cleanup complete (storage + encryption key retained)");
  }

}

/**
 * Wire all dependencies from a KubeConfig and return a ready-to-start TenantOperator.
 *
 * This factory owns all K8s client construction so that `TenantOperator` itself
 * only depends on the abstractions it actually needs. Use this from application
 * entry-points; inject helpers directly in tests.
 *
 * @param kc - Resolved KubeConfig (cluster or in-cluster credentials).
 * @param config - Operator runtime configuration from environment variables.
 * @param baseLog - Root pino logger; scoped to `tenant-operator` component inside.
 */
export function _CreateTenantOperator(kc: k8s.KubeConfig, config: OpenClawTenantOperatorConfig, baseLog: Logger): TenantOperator
{
  // 1. K8s API clients — each scoped to one API group; none leak into TenantOperator directly.
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
  const watch = new k8s.Watch(kc);

  // 2. Scoped logger — child-scoped here so all tenant-operator log lines share the label.
  const log = baseLog.child({ component: "tenant-operator" });

  // 3. Hosting adapter — selected once at startup; defaults to on-prem with no cloud config.
  const hosting = _BuildHostingAdapter(config);
  log.info({ provider: hosting.provider }, "hosting adapter initialised");

  // 4. K8s helpers — each receives only the API clients it actually calls.
  const cleanup = new TenantCleanup(objectApi, log);
  const statusWriter = new TenantStatusWriter(customApi, log);
  const encryptionKeys = new TenantEncryptionKeys(coreApi, objectApi, log);
  const liteLlmKeys = new TenantLiteLlmKeys(config, coreApi, objectApi, log);
  const cogneeTenantIdentity = new CogneeTenantIdentity(config, coreApi, objectApi, log);
  // 5. Org domain provisioner (#151 item 2) — always wired (cheap; each client fails closed
  //    on an absent CRD at call time), but only ever invoked when config.manageOwnDomain is
  //    true (standalone). Issuer name/kind come straight from this silo's own cert-manager
  //    config, matching whatever apps/opencrane-infra's own Issuer template renders.
  const domainProvisioner = _BuildOrgDomainProvisioner(customApi, {
    issuerName: config.certManagerIssuerName,
    issuerKind: config.certManagerIssuerKind,
  });

  return new TenantOperator(watch, customApi, coreApi, appsApi, networkingApi, log, config, hosting, cleanup, statusWriter, encryptionKeys, liteLlmKeys, cogneeTenantIdentity, domainProvisioner);
}
