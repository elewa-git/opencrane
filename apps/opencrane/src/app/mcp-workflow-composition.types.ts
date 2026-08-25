import type { McpEraProbeWorkflow, McpOperatorUnitOfWork, McpbBundleArtifactResolver, McpbValidationWorkflow, McpTaskWorkflow } from "@opencrane/backend/server/gateways/mcp";
import type { IWorkflowEngine, IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Groups MCP workflow dependencies with the guarded engine shared by this server process.
 *
 * Internal domain composition reuses {@link execution}; {@link runtime} remains the process-owned worker lifecycle.
 */
export interface McpWorkflowComposition
{
	/** Makes the guarded workflow engine available to other server domain compositions. */
	readonly execution: IWorkflowEngine;
	/** Transaction owner shared by MCP catalogue and bundle operations. */
	readonly unitOfWork: McpOperatorUnitOfWork;
	/** Absurd worker lifecycle started and drained by the OpenCrane process. */
	readonly runtime: IWorkflowWorkerRuntime;
	/** Domain workflow that checks a registered remote server. */
	readonly eraProbeWorkflow: McpEraProbeWorkflow;
	/** Domain workflow that verifies a saved MCP bundle. */
	readonly mcpbValidationWorkflow: McpbValidationWorkflow;
	/** Domain workflow that owns client-visible MCP task lifecycle state. */
	readonly mcpTaskWorkflow: McpTaskWorkflow;
	/** Read-only artifact lookup that derives byte facts inside the authenticated silo. */
	readonly mcpbArtifacts: McpbBundleArtifactResolver;
}
