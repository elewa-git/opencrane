/** Running route-convergence loop that must drain before Prisma disconnects. */
export interface ChannelTargetRouteReconciler
{
	/** Stop future passes and await the currently active reconciliation, if any. */
	stop(): Promise<void>;
}
