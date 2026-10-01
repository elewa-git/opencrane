import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { MCP_SERVER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import type { ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import type { McpServerWorkloadIdentityOptions, McpServerWorkloadIdentityReader } from "./mcp-server-workload.types";

/** Compose a fresh TokenReview for each remote claim without exposing the projected token to callers. */
export function _CreateMcpServerWorkloadIdentityReader(options: McpServerWorkloadIdentityOptions): McpServerWorkloadIdentityReader
{
	if (!isAbsolute(options.tokenPath) || options.expectedPodUid.trim().length === 0)
		throw new Error("MCP server workload identity configuration is invalid");
	return {
		async read(): Promise<ProductAuthorizationWorkloadContext>
		{
			try
			{
				const token = (await readFile(options.tokenPath, "utf8")).trim();
				if (token.length === 0 || token.length > 32_768)
					throw new Error("invalid projected token");
				const identity = await options.reviewer.__Review(token);
				if (identity === null || identity.podUid !== options.expectedPodUid)
					throw new Error("unverified server identity");
				return { audience: MCP_SERVER_PROJECTED_TOKEN_AUDIENCE, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, workloadKind: "pod", workloadUid: identity.podUid, podUid: identity.podUid };
			}
			catch
			{
				// Kubernetes errors can retain request objects, so no upstream error reaches product diagnostics.
				throw new Error("MCP server workload identity is unavailable");
			}
		},
	};
}
