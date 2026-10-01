import type { ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeTokenReviewer } from "@opencrane/backend/server/infra/workload-identity";

/** Supplies the current server Pod identity before a server-mediated remote MCP claim. */
export interface McpServerWorkloadIdentityReader
{
	/** Verify the current projected token and reject a Pod different from this process's deployment identity. */
	read(): Promise<ProductAuthorizationWorkloadContext>;
}

/** Deployment-owned coordinates and the existing Kubernetes authentication port. */
export interface McpServerWorkloadIdentityOptions
{
	/** Absolute path of the dedicated audience-bound projected server token. */
	readonly tokenPath: string;
	/** Immutable Pod UID supplied to this process by the Kubernetes Downward API. */
	readonly expectedPodUid: string;
	/** Reviewer fixed to the configured server namespace, ServiceAccount and MCP audience. */
	readonly reviewer: RuntimeTokenReviewer;
}
