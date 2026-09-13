import type { McpEraProbeWorkflow, McpOperatorUnitOfWork, OciImageLayoutArtifactResolver, OciImageValidationWorkflow } from "@opencrane/backend/server/gateways/mcp";
import type { IWorkflowEngine, IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";
import type { McpRemoteClient } from "@opencrane/backend/server/infra/mcp-remote-client";

/** MCP product authority and the one process-owned worker runtime shared by its saved jobs. */
export interface McpWorkflowComposition
{
	/** Standard MCP transport shared by catalogue checks, connection discovery and tool calls. */
	readonly remoteClient: McpRemoteClient;
	/** Makes the guarded workflow engine available to other server domain compositions. */
	readonly execution: IWorkflowEngine;
	/** Transaction owner shared by MCP catalogue and OCI image admission. */
	readonly unitOfWork: McpOperatorUnitOfWork;
	/** Absurd worker lifecycle started and drained by the OpenCrane process. */
	readonly runtime: IWorkflowWorkerRuntime;
	/** Domain workflow that checks a registered remote server. */
	readonly eraProbeWorkflow: McpEraProbeWorkflow;
	/** Domain workflow that verifies a saved OCI image. */
	readonly ociImageValidationWorkflow: OciImageValidationWorkflow;
	/** Read-only artifact lookup that derives byte facts inside the authenticated silo. */
	readonly ociImageArtifacts: OciImageLayoutArtifactResolver;
}
