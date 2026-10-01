import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import type { FixedServiceAccountTokenReviewer, MemoryGatewayServerIdentityConfig, ProjectedTokenReviewApi, ReviewedFixedServiceAccountIdentity } from "../token-review/workload-identity.types";
import { _ReviewProjectedToken } from "../token-review/projected-token-review";

/**
 * Shared body of every fixed-identity reviewer: verify a token for exactly one audience and
 * accept it only if the ServiceAccount username is exactly
 * `system:serviceaccount:{namespace}:{serviceAccountName}`.
 *
 * The audience and the expected username are captured when the reviewer is created, so no
 * later call can widen them — a caller can only ask "is this token that one identity".
 */
function _CreateFixedServiceAccountTokenReviewer(authApi: ProjectedTokenReviewApi, audience: string, namespace: string, serviceAccountName: string): FixedServiceAccountTokenReviewer
{
	return {
		async __Review(token: string): Promise<ReviewedFixedServiceAccountIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [audience]);
			const username = status?.user?.username ?? "";
			if (status === null || username !== `system:serviceaccount:${namespace}:${serviceAccountName}`)
				return null;
			return { username, namespace, serviceAccountName, audiences: status.audiences ?? [] };
		},
	};
}

/**
 * Build the reviewer that admits only the agent controller: the controller's own token
 * audience and ServiceAccount name come from `@opencrane/contracts`, so a caller chooses
 * only the namespace and cannot point it at a different account.
 *
 * Called by: apps/opencrane/src/bootstrap/process/runtime-composition.ts.
 *
 * @param authApi   - Kubernetes client used only to submit TokenReviews.
 * @param namespace - Namespace holding the controller's ServiceAccount, normally the
 *                    server's own namespace.
 * @returns A reviewer that returns the confirmed identity, or null for any other token.
 */
export function _CreateAgentControllerTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, namespace, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME);
}

/** Build the fixed TokenReview adapter for the dedicated artifact-preprocessor identity. */
export function _CreateArtifactPreprocessorTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, namespace, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME);
}

/** Build the fixed TokenReview adapter for the dedicated artifact-scanner identity. */
export function _CreateArtifactScannerTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, namespace, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME);
}

/** Build the fixed TokenReview adapter for the sole OpenCrane server admitted by memory-gateway. */
export function _CreateMemoryGatewayServerTokenReviewer(authApi: ProjectedTokenReviewApi, config: MemoryGatewayServerIdentityConfig): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, config.audience, config.namespace, config.serviceAccountName);
}
