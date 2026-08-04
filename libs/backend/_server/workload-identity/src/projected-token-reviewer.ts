import * as k8s from "@kubernetes/client-node";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { FixedServiceAccountTokenReviewer, ProjectedTokenReviewApi, ReviewedFixedServiceAccountIdentity, ReviewedSkillWorkloadIdentity, RuntimeIdentityNamespaceInput, RuntimeIdentityNamespaces, RuntimeTokenReviewer, RuntimeTokenReviewerConfig, RuntimeWorkloadIdentity, SkillWorkloadTokenReviewer } from "./workload-identity.types.js";

/** Return whether one value is a bounded Kubernetes namespace DNS label. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/** Validate the server and two runtime namespaces as one fail-closed identity boundary. */
export function _ValidateRuntimeIdentityNamespaces(config: RuntimeIdentityNamespaceInput): RuntimeIdentityNamespaces
{
	const { serverNamespace, personalRuntimeNamespace, managedRuntimeNamespace } = config;
	if (!_IsNamespace(serverNamespace) || !personalRuntimeNamespace || !_IsNamespace(personalRuntimeNamespace) || !managedRuntimeNamespace || !_IsNamespace(managedRuntimeNamespace) || personalRuntimeNamespace === serverNamespace || managedRuntimeNamespace === serverNamespace || personalRuntimeNamespace === managedRuntimeNamespace)
	{
		throw new Error("personal and managed runtime namespaces must be valid, distinct, and different from POD_NAMESPACE");
	}
	return { serverNamespace, personalRuntimeNamespace, managedRuntimeNamespace };
}

/** Validate one restricted worker namespace is well formed and isolated from the server identity. */
export function _ValidateIsolatedWorkloadNamespace(namespace: string | undefined, serverNamespace: string): string
{
	if (!namespace || !_IsNamespace(namespace) || namespace === serverNamespace) throw new Error("restricted workload namespace must be valid and different from POD_NAMESPACE");
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

/** Build a fixed-subject reviewer whose audience and identity cannot be widened by its caller. */
function _CreateFixedServiceAccountTokenReviewer(authApi: ProjectedTokenReviewApi, audience: string, namespace: string, serviceAccountName: string): FixedServiceAccountTokenReviewer
{
	return {
		async __Review(token: string): Promise<ReviewedFixedServiceAccountIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [audience]);
			const username = status?.user?.username ?? "";
			if (status === null || username !== `system:serviceaccount:${namespace}:${serviceAccountName}`) return null;
			return { username, namespace, serviceAccountName, audiences: status.audiences ?? [] };
		},
	};
}

/** Build the fixed TokenReview adapter for the sole agent-controller identity. */
export function _CreateAgentControllerTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, namespace, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME);
}

/** Build the fixed TokenReview adapter for the dedicated artifact-preprocessor identity. */
export function _CreateArtifactPreprocessorTokenReviewer(authApi: ProjectedTokenReviewApi, namespace: string): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, namespace, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME);
}

/** Build the reviewer for an authoring worker whose coordinates are later checked by bootstrap authority. */
export function _CreateSkillWorkloadTokenReviewer(authApi: ProjectedTokenReviewApi): SkillWorkloadTokenReviewer
{
	return {
		async __Review(token: string, audience: string): Promise<ReviewedSkillWorkloadIdentity | null>
		{
			const status = await _ReviewProjectedToken(authApi, token, [audience]);
			const subject = _ParseServiceAccountSubject(status?.user?.username ?? "");
			const podUid = _ReadReviewedPodUid(status?.user?.extra);
			return subject && podUid ? { ...subject, podUid } : null;
		},
	};
}

/** Parse one runtime identity only when namespace, account grammar, and bound Pod UID all match. */
function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null, isServiceAccountName: (value: string) => boolean): RuntimeWorkloadIdentity | null
{
	const parsed = _ParseServiceAccountSubject(subject);
	if (!parsed || parsed.namespace !== expectedNamespace || !isServiceAccountName(parsed.serviceAccountName) || !podUid) return null;
	return { subject, ...parsed, podUid };
}

/** Build the runtime transport's fail-closed projected Kubernetes TokenReview adapter. */
export function _CreateRuntimeTokenReviewer(authApi: ProjectedTokenReviewApi, config: RuntimeTokenReviewerConfig): RuntimeTokenReviewer
{
	return {
		async __Review(token: string): Promise<RuntimeWorkloadIdentity | null>
		{
			const audiences = [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE];
			const status = await _ReviewProjectedToken(authApi, token, audiences);
			if (!status) return null;
			const personal = status.audiences?.includes(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE) === true;
			const managed = status.audiences?.includes(MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE) === true;
			if (personal === managed) return null;
			const podUid = _ReadReviewedPodUid(status.user?.extra);
			return personal
				? _ParseRuntimeSubject(status.user?.username ?? "", config.personalRuntimeNamespace, podUid, ___IsAgentRuntimeServiceAccountName)
				: _ParseRuntimeSubject(status.user?.username ?? "", config.managedRuntimeNamespace, podUid, ___IsManagedAgentRuntimeServiceAccountName);
		},
	};
}
