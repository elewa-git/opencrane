import type { McpEraProbeWorkflow, McpOperatorUnitOfWork, OciImageLayoutArtifactResolver, OciImageValidationWorkflow } from "@opencrane/backend/server/gateways/mcp";
import type { IWorkflowWorkerRuntime } from "@opencrane/backend/server/infra/workflows/contract";

/** MCP product authority and the one process-owned worker runtime shared by its saved jobs. */
export interface McpWorkflowComposition
{
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
