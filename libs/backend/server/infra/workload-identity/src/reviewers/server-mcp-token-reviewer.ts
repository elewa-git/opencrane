import { MCP_SERVER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import type { ProjectedTokenReviewApi, RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "../token-review/workload-identity.types";
import { _ReviewProjectedToken } from "../token-review/projected-token-review";
import { _ReadReviewedPodUid, _ParseRuntimeSubject } from "../token-review/service-account-subject";
import { _IsNamespace } from "../configuration/workload-namespace";

/** Verify the server's projected token before attributing a remote tool claim to its actual Pod. */
export function _CreateMcpServerTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string, serviceAccountName: string): RuntimeTokenReviewer
{
	if (!_IsNamespace(namespace) || !_IsNamespace(serviceAccountName))
		throw new Error("MCP server workload identity must use valid Kubernetes names");
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [MCP_SERVER_PROJECTED_TOKEN_AUDIENCE]);
			const podUid = _ReadReviewedPodUid(status?.user?.extra);
			return _ParseRuntimeSubject(status?.user?.username ?? "", namespace, podUid, function _IsServerAccount(value): boolean { return value === serviceAccountName; });
		},
	};
}
