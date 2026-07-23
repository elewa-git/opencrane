import * as k8s from "@kubernetes/client-node";

import { _ResolveOwnClusterTenantName, _SeedOwnClusterTenant, _SeedOwnDefaultTenant } from "@opencrane/backend/server/tenancy/cluster-tenants";
import { PolicyOperator } from "@opencrane/backend/server/iam/policies";
import { GatewayProxyServer } from "@opencrane/server/_infra/channel-proxy";
import { CogneeLiteLlmKey } from "./reconcilers/tenants/internal/cognee-litellm-key.js";
import { CogneeSiloTenant } from "./reconcilers/tenants/internal/cognee-silo-tenant.js";
import { _CreateTenantOperator } from "./reconcilers/tenants/operator.js";
import { IdleChecker } from "./reconcilers/tenants/runtime/idle-checker.js";
import type { OpenClawTenantOperatorConfig } from "./operator-config.types.js";
import type { OpenClawTenantLifecycleOptions } from "./runtime-lifecycle.types.js";

/** Owns the legacy OpenClaw controllers until the target runtime slice deletes this package. */
export class OpenClawTenantLifecycle
{
  /** Immutable dependencies supplied by the app composition root. */
  private options: OpenClawTenantLifecycleOptions;
  /** Idle-suspension loop, populated after config loads. */
  private idleChecker: IdleChecker | null = null;
  /** Periodic Cognee owner/tenant heal timer. */
  private cogneeHealTimer: ReturnType<typeof setInterval> | null = null;
  /** In-process identity-routing channel proxy. */
  private channelProxy: GatewayProxyServer | null = null;

  /**
   * Create the runtime lifecycle without starting controllers.
   * @param options - Clients and composition callbacks owned by the app root.
   */
  constructor(options: OpenClawTenantLifecycleOptions)
  {
    this.options = options;
  }

  /** Start the legacy tenant controllers, preserving their current fail-soft boot semantics. */
  async start(): Promise<void>
  {
    const { kubeConfig, customApi, coreApi, prisma, publicPort, loadConfig, buildHostingAdapter, log } = this.options;
    try
    {
      // 1. Parse the app-owned environment before tenant seed.
      const config = loadConfig();
      log.info({ watchNamespace: config.watchNamespace }, "starting in-silo controllers");

      // 2. Assemble the tenant reconciler and run standalone-only authority seeds.
      const tenantOperator = _CreateTenantOperator(kubeConfig, config, buildHostingAdapter(config), log);
      this._startStandaloneSeeds(config, tenantOperator);

      // 3. Ensure the singleton Cognee identities and retain a slow liveness heal loop.
      this._startCogneeLifecycle(config);

      // 4. Start policy, idle, and channel controllers before entering both watch loops.
      const policyOperator = new PolicyOperator(kubeConfig, config, log);
      this.idleChecker = new IdleChecker(kubeConfig, config, log);
      this.idleChecker.start();
      this._startChannelProxy(config, publicPort);
      await Promise.all([tenantOperator.start(), policyOperator.start()]);
    }
    catch (err)
    {
      log.error({ err }, "in-silo controller bootstrap failed; the silo API stays up but the tenant runtime is NOT reconciling");
    }
  }

  /** Stop every auxiliary loop with an explicit shutdown contract. */
  async stop(): Promise<void>
  {
    if (this.cogneeHealTimer)
    {
      clearInterval(this.cogneeHealTimer);
    }
    this.idleChecker?.stop();
    await this.channelProxy?.stop();
  }

  /** Run the standalone ClusterTenant and default workspace seeds asynchronously. */
  private _startStandaloneSeeds(config: OpenClawTenantOperatorConfig, tenantOperator: { reconcileExistingTenantByName(name: string, namespace: string): Promise<void> }): void
  {
    void this._runStandaloneSeeds(config, tenantOperator);
  }

  /** Perform the ordered standalone seeds and immediately reconcile a newly created workspace. */
  private async _runStandaloneSeeds(config: OpenClawTenantOperatorConfig, tenantOperator: { reconcileExistingTenantByName(name: string, namespace: string): Promise<void> }): Promise<void>
  {
    if (config.standaloneSeedName.trim())
    {
      await _SeedOwnClusterTenant(this.options.customApi, config.watchNamespace, {
        name: config.standaloneSeedName,
        displayName: config.standaloneSeedDisplayName,
        ownerEmail: config.standaloneSeedOwnerEmail,
        ownerSubject: config.standaloneSeedOwnerSubject,
        tier: config.standaloneSeedTier,
      }, this.options.log);
    }

    const seedResult = await _SeedOwnDefaultTenant(this.options.customApi, this.options.prisma, config.watchNamespace, this.options.log);
    if (!seedResult?.created)
    {
      return;
    }
    try
    {
      await tenantOperator.reconcileExistingTenantByName(seedResult.tenantName, config.watchNamespace);
      this.options.log.info({ tenantName: seedResult.tenantName }, "queued standalone default tenant for immediate reconciliation");
    }
    catch (err)
    {
      this.options.log.warn({ err, tenantName: seedResult.tenantName }, "standalone default tenant immediate reconcile failed; watch replay remains the backstop");
    }
  }

  /** Start boot-time Cognee provisioning plus the idempotent singleton heal loop. */
  private _startCogneeLifecycle(config: OpenClawTenantOperatorConfig): void
  {
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(this.options.kubeConfig);
    const appsApi = this.options.kubeConfig.makeApiClient(k8s.AppsV1Api);
    void this._ensureCognee(config, objectApi, appsApi);
    if (!config.cogneeEndpoint)
    {
      return;
    }

    const healer = new CogneeSiloTenant(config, this.options.coreApi, objectApi, this.options.log);
    const { customApi, log } = this.options;
    async function _runHeal(): Promise<void>
    {
      try
      {
        const name = await _ResolveOwnClusterTenantName(customApi, config.watchNamespace, log);
        if (name)
        {
          await healer.ensureSiloTenant(name, config.watchNamespace);
        }
      }
      catch (err)
      {
        log.warn({ err }, "cognee silo-tenant heal tick failed; will retry next interval");
      }
    }
    this.cogneeHealTimer = setInterval(function _heal()
    {
      void _runHeal();
    }, 60_000);
  }

  /** Ensure the dedicated Cognee LiteLLM key and singleton silo tenant independently. */
  private async _ensureCognee(config: OpenClawTenantOperatorConfig, objectApi: k8s.KubernetesObjectApi, appsApi: k8s.AppsV1Api): Promise<void>
  {
    const name = await _ResolveOwnClusterTenantName(this.options.customApi, config.watchNamespace, this.options.log);
    if (!name)
    {
      this.options.log.info({ namespace: config.watchNamespace }, "no ClusterTenant bound to this namespace yet; cognee provisioning idle");
      return;
    }
    try
    {
      await new CogneeLiteLlmKey(config, this.options.coreApi, objectApi, appsApi, this.options.log).ensureCogneeLiteLlmKeySecret(name, config.watchNamespace);
    }
    catch (err)
    {
      this.options.log.warn({ err, clusterTenantName: name }, "cognee litellm key provisioning failed; cognee will run without embedding/LLM credentials until this is retried");
    }
    try
    {
      await new CogneeSiloTenant(config, this.options.coreApi, objectApi, this.options.log).ensureSiloTenant(name, config.watchNamespace);
    }
    catch (err)
    {
      this.options.log.warn({ err, clusterTenantName: name }, "cognee silo tenant provisioning failed; per-tenant logins will join it once this is retried");
    }
  }

  /** Start the optional in-process channel proxy with the app's public listener as auth delegate. */
  private _startChannelProxy(config: OpenClawTenantOperatorConfig, publicPort: number): void
  {
    if (!config.gatewayProxyEnabled)
    {
      this.options.log.info("in-silo gateway proxy disabled (GATEWAY_PROXY_ENABLED not true)");
      return;
    }
    this.channelProxy = new GatewayProxyServer({
      port: config.gatewayProxyPort,
      controlPlaneUrl: `http://localhost:${publicPort}`,
      gatewayPort: config.gatewayPort,
      clusterDomain: config.clusterDomain,
      userHeader: config.gatewayTrustedProxyUserHeader,
      allowedOrigins: config.gatewayProxyAllowedOrigins,
      allowedOriginBaseDomains: config.gatewayProxyAllowedOriginBaseDomains,
      rateLimitPerMinute: config.gatewayProxyRateLimitPerMinute,
    }, this.options.log);
    this.channelProxy.start();
  }
}
