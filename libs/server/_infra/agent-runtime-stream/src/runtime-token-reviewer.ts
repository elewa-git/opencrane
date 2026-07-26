import * as k8s from "@kubernetes/client-node";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/observability";

import type { RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "./agent-runtime-stream.types.js";

/**
 * Convert one reviewed Kubernetes subject into the identity accepted by the runtime transport.
 *
 * A reviewed ServiceAccount still represents a workload class. Requiring its namespace, bounded
 * runtime-profile name, and TokenReview-provided Pod UID makes the returned identity specific to the
 * exact runtime Pod that owns a run attempt.
 */
function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null): RuntimeWorkloadIdentity | null
{
	const parts = subject.split(":");
	const serviceAccountName = parts[3];
	if (parts.length !== 4 || parts[0] !== "system" || parts[1] !== "serviceaccount" || parts[2] !== expectedNamespace || !serviceAccountName || !___IsAgentRuntimeServiceAccountName(serviceAccountName) || !podUid)
	{
		return null;
	}
	return { subject, namespace: expectedNamespace, serviceAccountName, podUid };
}

/** Read the Pod UID claim Kubernetes attaches to a bound projected ServiceAccount token. */
function _ReadReviewedPodUid(extra: Record<string, string[]> | undefined): string | null
{
	const podUid = extra?.["authentication.kubernetes.io/pod-uid"]?.[0];
	return typeof podUid === "string" && podUid.length > 0 ? podUid : null;
}

/** Submit one audience-bound projected token and return only an authenticated matching review. */
async function _ReviewProjectedToken(authApi: k8s.AuthenticationV1Api, token: string): Promise<k8s.V1TokenReviewStatus | null>
{
	return ___DoWithTrace("kubernetes.projected_token.review", { audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE }, async function _reviewToken(): Promise<k8s.V1TokenReviewStatus | null>
	{
		const body = new k8s.V1TokenReview();
		body.spec = new k8s.V1TokenReviewSpec();
		body.spec.token = token;
		body.spec.audiences = [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE];
		const review = await authApi.createTokenReview({ body });
		const status = review.status;
		return status?.authenticated && status.audiences?.includes(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE) ? status : null;
	});
}

/**
 * Build the runtime transport's fail-closed Kubernetes TokenReview adapter.
 *
 * The adapter fixes the runtime audience and namespace before exposing a workload identity. It never
 * forwards the raw token or full TokenReview response, so the stream can trust only an authenticated,
 * audience-bound token from the exact assigned runtime Pod.
 */
export function _CreateRuntimeTokenReviewer(authApi: k8s.AuthenticationV1Api, runtimeNamespace: string): RuntimeTokenReviewer
{
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token);
			if (!status) return null;
			return _ParseRuntimeSubject(status.user?.username ?? "", runtimeNamespace, _ReadReviewedPodUid(status.user?.extra));
		},
	};
}
