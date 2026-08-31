import type { IWorkflowEngine, IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/** Durable task admission owned by the Tier 2 server and consumed by the local controller. */
export interface DevelopmentWorkflowComposition
{
	/** Guarded workflow engine passed to product transactions that admit local Agent work. */
	readonly execution: IWorkflowEngine;
	/** Engine lifecycle closed before the Tier 2 Prisma client disconnects. */
	readonly runtime: IWorkflowWorkerRuntime;
}
