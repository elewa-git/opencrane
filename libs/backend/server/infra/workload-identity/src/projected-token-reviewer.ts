import * as k8s from "@kubernetes/client-node";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME, SKILL_AUTHORING_VALIDATION_PROJECTED_TOKEN_AUDIENCE, SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { FixedServiceAccountTokenReviewer, MemoryGatewayServerIdentityConfig, ProjectedTokenReviewApi, ReviewedFixedServiceAccountIdentity, RuntimeTokenReviewer, RuntimeWorkloadIdentity } from "./workload-identity.types";

/** Return whether one value is a bounded Kubernetes namespace DNS label. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/**
 * Check one worker namespace at startup: it must be present, a valid DNS label, and
 * different from the server's own namespace, so a worker's token can never be mistaken for
 * the server's.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts, for the artifact
 * preprocessor namespace.
 *
 * @param namespace       - Namespace from deployment configuration; may be undefined.
 * @param serverNamespace - The already validated server namespace.
 * @returns The namespace, confirmed usable.
 * @throws When it is missing, malformed, or equal to the server namespace.
 */
export function _ValidateIsolatedWorkloadNamespace(namespace: string | undefined, serverNamespace: string): string
{
	if (!namespace || !_IsNamespace(namespace) || namespace === serverNamespace)
		throw new Error("restricted workload namespace must be valid and different from POD_NAMESPACE");
	return namespace;
}

/** Submit one audience-bound credential and expose only an authenticated matching TokenReview. */
async function _ReviewProjectedToken(authApi: ProjectedTokenReviewApi, token: string, audiences: readonly string[]): Promise<k8s.V1TokenReviewStatus | null>
{
	return ___DoWithTrace("kubernetes.projected_token.review", { audienceClasses: audiences.length }, async function _reviewToken(): Promise<k8s.V1TokenReviewStatus | null>
	{
		const body = new k8s.V1TokenReview();
		body.spec = new k8s.V1TokenReviewSpec();
		body.spec.token = token;
		body.spec.audiences = [...audiences];
		const review = await authApi.createTokenReview({ body });
		const status = review.status;
		return status?.authenticated && status.audiences?.some(function _accepted(audience) { return audiences.includes(audience); }) ? status : null;
	});
}

/** Read the Pod UID Kubernetes attaches to a bound projected ServiceAccount token. */
function _ReadReviewedPodUid(extra: Record<string, string[]> | undefined): string | null
{
	const podUid = extra?.["authentication.kubernetes.io/pod-uid"]?.[0];
	return typeof podUid === "string" && podUid.length > 0 ? podUid : null;
}

/** Parse a Kubernetes ServiceAccount username into bounded namespace and account coordinates. */
function _ParseServiceAccountSubject(username: string): { readonly namespace: string; readonly serviceAccountName: string } | null
{
	const match = /^system:serviceaccount:([a-z0-9]([-a-z0-9]*[a-z0-9])?):([a-z0-9]([-a-z0-9]*[a-z0-9])?)$/.exec(username);
	return match ? { namespace: match[1]!, serviceAccountName: match[3]! } : null;
}

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
 * Called by: apps/opencrane/src/app/runtime-composition.ts.
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

/** Build the fixed TokenReview adapter for the sole OpenCrane server admitted by memory-gateway. */
export function _CreateMemoryGatewayServerTokenReviewer(authApi: ProjectedTokenReviewApi, config: MemoryGatewayServerIdentityConfig): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, config.audience, config.namespace, config.serviceAccountName);
}

/** Return the runtime identity only when the subject parses, its namespace is the expected one, its ServiceAccount name passes the supplied name check, and the token carried a bound Pod UID. */
function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null, isServiceAccountName: (value: string) => boolean): RuntimeWorkloadIdentity | null
{
	const parsed = _ParseServiceAccountSubject(subject);
	if (!parsed || parsed.namespace !== expectedNamespace || !isServiceAccountName(parsed.serviceAccountName) || !podUid)
		return null;
	return { subject, ...parsed, podUid };
}
