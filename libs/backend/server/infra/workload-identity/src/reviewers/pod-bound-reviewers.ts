import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME, SKILL_AUTHORING_VALIDATION_PROJECTED_TOKEN_AUDIENCE, SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import type { ProjectedTokenReviewApi, RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "../token-review/workload-identity.types";
import { _ReviewProjectedToken } from "../token-review/projected-token-review";
import { _ReadReviewedPodUid, _ParseRuntimeSubject } from "../token-review/service-account-subject";
import { _IsNamespace } from "../configuration/workload-namespace";

/** Build the Pod-bound reviewer for the isolated OCI MCP executor companion. */
export function _CreateMcpExecutorTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): RuntimeTokenReviewer
{
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE]);
			const podUid = _ReadReviewedPodUid(status?.user?.extra);
			return _ParseRuntimeSubject(status?.user?.username ?? "", namespace, podUid, function _IsMcpExecutorServiceAccount(value): boolean { return value === MCP_EXECUTOR_SERVICE_ACCOUNT_NAME; });
		},
	};
}

/** Build the Pod-bound reviewer for one release-fixed conversation-computer ServiceAccount. */
export function _CreateConversationComputerTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string, serviceAccountName: string): RuntimeTokenReviewer
{
	if (!_IsNamespace(namespace) || !_IsNamespace(serviceAccountName))
		throw new Error("conversation-computer workload identity must use valid Kubernetes names");
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE]);
			const podUid = _ReadReviewedPodUid(status?.user?.extra);
			return _ParseRuntimeSubject(status?.user?.username ?? "", namespace, podUid, function _IsConversationComputerServiceAccount(value): boolean { return value === serviceAccountName; });
		},
	};
}

/** Build the Pod-bound reviewer for the sole Python skill-validation workload identity. */
export function _CreateSkillAuthoringValidationTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): RuntimeTokenReviewer
{
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [SKILL_AUTHORING_VALIDATION_PROJECTED_TOKEN_AUDIENCE]);
			const podUid = _ReadReviewedPodUid(status?.user?.extra);
			return _ParseRuntimeSubject(status?.user?.username ?? "", namespace, podUid, function _IsSkillAuthoringValidationServiceAccount(value): boolean { return value === SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME; });
		},
	};
}
