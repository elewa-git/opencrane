import * as k8s from "@kubernetes/client-node";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import type { ChannelProxyTokenReviewerConfig, FixedServiceAccountTokenReviewer, MemoryGatewayServerIdentityConfig, ProjectedTokenReviewApi, ReviewedFixedServiceAccountIdentity, ReviewedSkillWorkloadIdentity, RuntimeIdentityNamespaceInput, RuntimeIdentityNamespaces, RuntimeTokenReviewer, RuntimeTokenReviewerConfig, RuntimeWorkloadIdentity, SkillWorkloadTokenReviewer } from "./workload-identity.types";

/** Return whether one value is a bounded Kubernetes namespace DNS label. */
function _IsNamespace(value: string): boolean
{
	return value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/**
 * Check the three namespaces the server needs to keep identities apart, at startup.
 *
 * All three must be valid DNS labels, both runtime namespaces must be present, and all
 * three must differ from each other. Sharing a namespace would put the server and a
 * runtime — or a personal and a managed runtime — in the same identity space, where one
 * could present a token accepted for the other, so a missing or duplicated value stops the
 * process instead of defaulting to something.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts, before any reviewer
 * is built.
 *
 * @param config - Namespaces as read from deployment configuration.
 * @returns The same three names, now all present, for use where they are required.
 * @throws When any name is missing, is not a valid DNS label, or repeats another — startup
 *         must fail rather than run with runtime identities that overlap.
 */
export function _ValidateRuntimeIdentityNamespaces(config: RuntimeIdentityNamespaceInput): RuntimeIdentityNamespaces
{
	const { serverNamespace, personalRuntimeNamespace, managedRuntimeNamespace } = config;
	if (!_IsNamespace(serverNamespace) || !personalRuntimeNamespace || !_IsNamespace(personalRuntimeNamespace) || !managedRuntimeNamespace || !_IsNamespace(managedRuntimeNamespace) || personalRuntimeNamespace === serverNamespace || managedRuntimeNamespace === serverNamespace || personalRuntimeNamespace === managedRuntimeNamespace)
	{
		throw new Error("personal and managed runtime namespaces must be valid, distinct, and different from POD_NAMESPACE");
	}
	return { serverNamespace, personalRuntimeNamespace, managedRuntimeNamespace };
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
			if (status === null || username !== `system:serviceaccount:${namespace}:${serviceAccountName}`) return null;
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

/** Build the fixed TokenReview adapter for one deployment-owned channel-proxy identity. */
export function _CreateChannelProxyTokenReviewer(authApi: ProjectedTokenReviewApi, config: ChannelProxyTokenReviewerConfig): FixedServiceAccountTokenReviewer
{
	if (!config.audience.trim() || !config.namespace.trim() || !config.serviceAccountName.trim()) throw new Error("channel-proxy workload identity must be configured");
	return _CreateFixedServiceAccountTokenReviewer(authApi, config.audience, config.namespace, config.serviceAccountName);
}

/** Build the fixed TokenReview adapter for the sole OpenCrane server admitted by memory-gateway. */
export function _CreateMemoryGatewayServerTokenReviewer(authApi: ProjectedTokenReviewApi, config: MemoryGatewayServerIdentityConfig): FixedServiceAccountTokenReviewer
{
	return _CreateFixedServiceAccountTokenReviewer(authApi, config.audience, config.namespace, config.serviceAccountName);
}

/**
 * Build the reviewer for authoring workers. Unlike the fixed reviewers, it fixes NO
 * identity: the audience is supplied per call, and any valid ServiceAccount token with a
 * bound Pod UID is returned. Deciding whether that worker is the expected one is left to
 * the stored bootstrap record, so a non-null result here is authentication only, never
 * authorization.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts.
 *
 * @param authApi - Kubernetes client used only to submit TokenReviews.
 * @returns A reviewer returning the worker's namespace, ServiceAccount name, and Pod UID,
 *          or null when the token is invalid for the requested audience or has no Pod UID.
 */
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

/** Return the runtime identity only when the subject parses, its namespace is the expected one, its ServiceAccount name passes the supplied name check, and the token carried a bound Pod UID. */
function _ParseRuntimeSubject(subject: string, expectedNamespace: string, podUid: string | null, isServiceAccountName: (value: string) => boolean): RuntimeWorkloadIdentity | null
{
	const parsed = _ParseServiceAccountSubject(subject);
	if (!parsed || parsed.namespace !== expectedNamespace || !isServiceAccountName(parsed.serviceAccountName) || !podUid) return null;
	return { subject, ...parsed, podUid };
}

/**
 * Build the reviewer the runtime stream transport uses to authenticate agent runtimes.
 *
 * It submits the token for BOTH runtime audiences at once and then requires exactly one of
 * them to have been accepted. A token accepted for both, or for neither, is rejected: the
 * audience is what distinguishes a personal runtime from a managed one, and that choice
 * then decides which namespace and which ServiceAccount naming rule must match. Allowing
 * both would let one class of runtime be checked against the other's rules.
 *
 * After that, the ServiceAccount subject must parse, its namespace must equal the
 * configured namespace for that class, its name must satisfy that class's naming rule, and
 * the token must carry a bound Pod UID. Any failure returns null.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts; the result is
 * passed to both the runtime bootstrap router and the runtime stream transport.
 *
 * @param authApi - Kubernetes client used only to submit TokenReviews.
 * @param config  - The two validated runtime namespaces; see
 *                  {@link _ValidateRuntimeIdentityNamespaces}.
 * @returns A reviewer that returns a verified identity or null; it never explains why.
 * @see https://kubernetes.io/docs/reference/access-authn-authz/authentication/ — TokenReview,
 *      token audiences, and the extra fields that carry the bound Pod UID.
 */
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
