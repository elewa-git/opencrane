import { _ResolveOwnClusterTenantName } from "@opencrane/backend/server/cluster-tenants";
import { MembershipProjectionRepairer, _BuildHttpFleetMembershipReader } from "./membership-projection-repairer.js";
import { TenantProjectionRepairer } from "./tenant-projection-repairer.js";
import type { ProjectionLifecycleOptions } from "./projection-lifecycle.types.js";

/** Owns the two fail-soft CRD and fleet projection repair loops for one silo. */
export class ProjectionLifecycle
{
  /** Immutable dependencies and runtime settings. */
  private options: ProjectionLifecycleOptions;
  /** Tenant CRD-to-database repair loop. */
  private tenantRepairer: TenantProjectionRepairer;
  /** Membership repair loop, created after the silo org resolves. */
  private membershipRepairer: MembershipProjectionRepairer | null = null;

  /**
   * Create the projection lifecycle without starting background work.
   * @param options - Injected clients and environment-derived settings.
   */
  constructor(options: ProjectionLifecycleOptions)
  {
    this.options = options;
    this.tenantRepairer = new TenantProjectionRepairer(options.customApi, options.prisma, options.namespace, options.log, options.intervalMs);
  }

  /** Start tenant repair immediately and resolve the membership source asynchronously. */
  start(): void
  {
    this.tenantRepairer.start();
    void this._startMembershipRepairer();
  }

  /** Stop every repair loop that has been started. */
  stop(): void
  {
    this.tenantRepairer.stop();
    this.membershipRepairer?.stop();
  }

  /** Resolve this silo's org and start its fleet-to-silo membership projection. */
  private async _startMembershipRepairer(): Promise<void>
  {
    const { customApi, prisma, namespace, intervalMs, fleetInternalUrl, fleetInternalToken, log, enforcement } = this.options;
    const clusterTenant = await _ResolveOwnClusterTenantName(customApi, namespace, log);
    if (!clusterTenant)
    {
      log.info({ namespace }, "no ClusterTenant bound to this namespace yet; membership projection repairer idle");
      return;
    }

    const reader = _BuildHttpFleetMembershipReader(fleetInternalUrl, fleetInternalToken, log);
    this.membershipRepairer = new MembershipProjectionRepairer(prisma, reader, clusterTenant, log, intervalMs, enforcement);
    this.membershipRepairer.start();
  }
}
