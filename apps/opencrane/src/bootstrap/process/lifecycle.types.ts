import type { Server } from "node:http";

import type { ConversationComputerActivationWorker } from "@opencrane/backend/server/conversations";

/** Public and workload-facing listeners owned by one OpenCrane process. */
export interface OpenCraneHttpServers
{
	/** Workload-facing server excluded from public ingress. */
	readonly internal: Server;
	/** Public ingress-facing server. */
	readonly public: Server;
}

/** Repairs persisted work that must exist before the process starts durable workers. */
export interface OpenCraneStartupRecovery
{
	/** Re-admits every active routine schedule head and returns the number checked. */
	repairAllActiveSchedules(): Promise<number>;
}

/** Starts process-owned computer workers only after durable startup repair has succeeded. */
export interface OpenCraneStartupWorkerFactory
{
	/** Start every computer worker and return their shared shutdown receipt. */
	start(): Promise<ConversationComputerActivationWorker>;
}
