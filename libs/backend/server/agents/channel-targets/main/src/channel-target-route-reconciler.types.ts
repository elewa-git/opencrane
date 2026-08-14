import type { Logger } from "@opencrane/backend/observability";

import type { ChannelTargetAuthorityRepository, ReconcileChannelRuntimeRoutesCommand } from "./channel-target-resolution.types";

/** Running route-convergence loop that drains before its repository closes. */
export interface ChannelTargetRouteReconciler
{
	/** Stop future passes and await the currently active reconciliation, if any. */
	stop(): Promise<void>;
}

/** Complete route-reconciler dependency and retry policy. */
export interface ChannelTargetRouteReconcilerDependencies
{
	/** Durable route authority invoked by each reconciliation pass. */
	readonly repository: Pick<ChannelTargetAuthorityRepository, "reconcileRuntimeRoutes">;
	/** Deployment-owned route registration, or null when the feature is disabled. */
	readonly command: ReconcileChannelRuntimeRoutesCommand | null;
	/** Structured logger that receives safe pass outcomes. */
	readonly logger: Pick<Logger, "debug" | "error">;
	/** Delay between non-overlapping convergence passes. */
	readonly intervalMilliseconds: number;
}
