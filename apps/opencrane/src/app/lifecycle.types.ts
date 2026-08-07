import type { Server } from "node:http";

/** Public and workload-facing listeners owned by one OpenCrane process. */
export interface OpenCraneHttpServers
{
	/** Workload-facing server excluded from public ingress. */
	readonly internal: Server;
	/** Public ingress-facing server. */
	readonly public: Server;
}
