import type { McpEraProbeWorkflow, McpOperatorUnitOfWork } from "@opencrane/backend/server/gateways/mcp";
import type { DurableWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/** MCP registration authority and its process-owned durable worker runtime. */
export interface McpEraProbeComposition
{
	/** Transaction owner shared by existing MCP operations and remote registration. */
	readonly unitOfWork: McpOperatorUnitOfWork;
	/** Absurd worker lifecycle started and drained by the OpenCrane process. */
	readonly runtime: DurableWorkerRuntime;
	/** Domain workflow that admits an era check in the registration database transaction. */
	readonly workflow: McpEraProbeWorkflow;
}
