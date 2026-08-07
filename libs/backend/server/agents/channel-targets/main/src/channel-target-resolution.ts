import { createHash, randomBytes } from "node:crypto";

import type { AuthorizedChannelTargetResult, ChannelAuthorizedAction, ChannelOpaqueContextSource, ChannelTargetClock, ChannelTargetResolutionDependencies, DelegatedBrowserIdentityDecision, ResolveChannelTargetCommand, ResolveChannelTargetResult } from "./channel-target-resolution.types.js";

/** Real wall clock for production composition. */
export class __SystemChannelTargetClock implements ChannelTargetClock
{
	/** Returns current epoch-millisecond time. */
	nowEpochMs(): number
	{
		return Date.now();
	}
}

/** Cryptographically secure opaque invocation-context source. */
export class __RandomChannelOpaqueContextSource implements ChannelOpaqueContextSource
{
	/** Returns 256 random bits encoded without bearer-unsafe characters. */
	create(): string
	{
		return randomBytes(32).toString("base64url");
	}
}

/** Resolves a delegated browser operation to one authorized runtime route. */
export async function __ResolveChannelTarget(dependencies: ChannelTargetResolutionDependencies, command: ResolveChannelTargetCommand): Promise<ResolveChannelTargetResult>
{
	const nowEpochMs = dependencies.clock.nowEpochMs();

	// 1. Reject incomplete or unsafe inputs before querying any identity authority.
	if (!_commandIsValid(command) || !_configIsValid(dependencies, nowEpochMs))
	{
		return { outcome: "denied", reason: "invalid_request" };
	}

	// 2. TokenReview the channel-proxy token and require the exact audience, KSA, namespace, and username.
	const workload = await dependencies.workloadIdentity.review(command.workloadToken, dependencies.config.workloadAudience);
	const expectedUsername = `system:serviceaccount:${dependencies.config.channelProxyNamespace}:${dependencies.config.channelProxyServiceAccountName}`;
	if (workload.outcome !== "trusted"
		|| workload.identity.serviceAccountName !== dependencies.config.channelProxyServiceAccountName
		|| workload.identity.namespace !== dependencies.config.channelProxyNamespace
		|| workload.identity.username !== expectedUsername
		|| !workload.identity.audiences.includes(dependencies.config.workloadAudience))
	{
		return { outcome: "denied", reason: "workload_denied" };
	}

	// 3. Resolve the browser cookie first. A present-but-invalid cookie never falls back to bearer.
	const delegatedIdentity = await _resolveDelegatedIdentity(dependencies, command);
	if (delegatedIdentity.outcome !== "trusted" || !delegatedIdentity.identity.trustworthySubject || !delegatedIdentity.identity.subjectId.trim())
	{
		return { outcome: "denied", reason: "identity_denied" };
	}
	const subjectId = delegatedIdentity.identity.subjectId;

	// 4. Bind the already origin-checked host to one registered silo and current signed membership.
	const hostBinding = await dependencies.hostSilo.resolveExactHost(command.trustedHost);
	if (hostBinding === null || !hostBinding.siloId.trim())
	{
		return { outcome: "denied", reason: "host_denied" };
	}
	const membership = await dependencies.membership.verifyCurrentMembership(subjectId, hostBinding.siloId, hostBinding.authorizationScope, nowEpochMs);
	if (membership.outcome !== "trusted" || !Number.isSafeInteger(membership.revision) || membership.revision < 1 || !Number.isSafeInteger(membership.trustedUntilEpochMs) || membership.trustedUntilEpochMs <= nowEpochMs)
	{
		return { outcome: "denied", reason: "membership_denied" };
	}

	// 5. Require an active thread bound to the same silo, service, and explicit participant.
	const thread = await dependencies.repository.getThreadAuthority(command.threadId);
	if (thread === null || thread.state !== "active" || thread.siloId !== hostBinding.siloId || !thread.agentServiceId.trim() || !thread.participantUserIds.includes(subjectId))
	{
		return { outcome: "denied", reason: "thread_denied" };
	}

	// 6. Authorize the complete action set; command forwarding requires both message and run authority.
	const requiredActions = _requiredActions(command.action);
	const authorization = await dependencies.authorization.authorize({
		subjectId,
		siloId: hostBinding.siloId,
		threadId: thread.threadId,
		agentServiceId: thread.agentServiceId,
		scope: hostBinding.authorizationScope,
		requiredActions,
		membershipRevision: membership.revision,
		nowEpochMs,
	});
	if (authorization.outcome !== "allowed" || !/^sha256:[0-9a-f]{64}$/u.test(authorization.authorizationDigest))
	{
		return { outcome: "denied", reason: "authorization_denied" };
	}

	// 7. Commands require a real durable run authority. An absent/unready controller path fails closed.
	let runId: string | null = null;
	if (command.action === "command.forward")
	{
		const run = await dependencies.runStart.prepareInteractiveRun({ subjectId, siloId: hostBinding.siloId, threadId: thread.threadId, agentServiceId: thread.agentServiceId, authorizationDigest: authorization.authorizationDigest, requestIdempotencyKey: command.requestIdempotencyKey! });
		if (run.outcome === "unavailable") return { outcome: "denied", reason: "run_unavailable" };
		if (run.outcome !== "ready" || !run.runId.trim()) return { outcome: "denied", reason: "run_denied" };
		runId = run.runId;
	}

	// 8. Generate an opaque context, persist only its digest, and atomically recheck every DB binding.
	const invocationContext = dependencies.opaqueContext.create();
	if (!/^[A-Za-z0-9_-]{43,}$/u.test(invocationContext))
	{
		return { outcome: "denied", reason: "route_denied" };
	}
	const digest = `sha256:${createHash("sha256").update(invocationContext, "utf8").digest("hex")}`;
	const expiresAtEpochMs = Math.min(nowEpochMs + dependencies.config.invocationContextTtlMs, membership.trustedUntilEpochMs);
	if (expiresAtEpochMs <= nowEpochMs)
	{
		return { outcome: "denied", reason: "membership_denied" };
	}
	const issued = await dependencies.repository.issueInvocationContextAtomically({ digest, subjectId, siloId: hostBinding.siloId, threadId: thread.threadId, agentServiceId: thread.agentServiceId, action: command.action, runId, membershipRevision: membership.revision, authorizationDigest: authorization.authorizationDigest, nowEpochMs, expiresAtEpochMs, allowedRouteHostSuffixes: dependencies.config.allowedRouteHostSuffixes });
	if (issued.status !== "issued" || !_endpointIsAllowed(issued.context.endpoint, dependencies.config.allowedRouteHostSuffixes))
	{
		return { outcome: "denied", reason: "route_denied" };
	}

	const target: AuthorizedChannelTargetResult = { subjectId, endpoint: issued.context.endpoint, invocationContext, expiresAt: new Date(expiresAtEpochMs).toISOString() };
	return { outcome: "authorized", target };
}

/** Resolves cookie before bearer and refuses cross-mechanism fallback. */
async function _resolveDelegatedIdentity(dependencies: ChannelTargetResolutionDependencies, command: ResolveChannelTargetCommand): Promise<DelegatedBrowserIdentityDecision>
{
	if (command.cookie?.trim())
	{
		const decision = await dependencies.delegatedIdentity.resolveCookie(command.cookie);
		if (decision.outcome === "trusted" && decision.identity.source !== "cookie") return { outcome: "denied", reason: "identity_source_mismatch" };
		return decision;
	}
	if (command.delegatedAuthorization?.trim())
	{
		const decision = await dependencies.delegatedIdentity.resolveBearer(command.delegatedAuthorization);
		if (decision.outcome === "trusted" && decision.identity.source !== "bearer") return { outcome: "denied", reason: "identity_source_mismatch" };
		return decision;
	}
	return { outcome: "denied", reason: "missing_identity" };
}

/** Returns the complete product action set for one proxy operation. */
function _requiredActions(action: ResolveChannelTargetCommand["action"]): readonly ChannelAuthorizedAction[]
{
	return action === "command.forward" ? ["agent.run.start", "thread.message.create"] : ["thread.read"];
}

/** Validates target-neutral request structure without interpreting credentials. */
function _commandIsValid(command: ResolveChannelTargetCommand): boolean
{
	return command.workloadToken.trim().length > 0
		&& /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/u.test(command.trustedHost)
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(command.threadId)
		&& (command.action === "command.forward" || command.action === "events.read")
		&& (command.action !== "command.forward" || (command.requestIdempotencyKey !== undefined && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(command.requestIdempotencyKey)))
		&& (command.cursor === undefined || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(command.cursor));
}

/** Validates fixed resolver policy and trusted time. */
function _configIsValid(dependencies: ChannelTargetResolutionDependencies, nowEpochMs: number): boolean
{
	return Number.isSafeInteger(nowEpochMs)
		&& nowEpochMs >= 0
		&& dependencies.config.workloadAudience === "opencrane"
		&& dependencies.config.channelProxyServiceAccountName.trim().length > 0
		&& dependencies.config.channelProxyNamespace.trim().length > 0
		&& Number.isSafeInteger(dependencies.config.invocationContextTtlMs)
		&& dependencies.config.invocationContextTtlMs > 0
		&& dependencies.config.invocationContextTtlMs <= 300_000
		&& dependencies.config.allowedRouteHostSuffixes.length > 0
		&& dependencies.config.allowedRouteHostSuffixes.every(suffix => suffix.startsWith(".") && suffix.length > 1);
}

/** Accepts only credential-free HTTP(S) endpoints within configured internal DNS suffixes. */
function _endpointIsAllowed(endpoint: string, allowedSuffixes: readonly string[]): boolean
{
	let url: URL;
	try
	{
		url = new URL(endpoint);
	}
	catch
	{
		return false;
	}
	return (url.protocol === "http:" || url.protocol === "https:")
		&& !url.username
		&& !url.password
		&& !url.hash
		&& allowedSuffixes.some(suffix => url.hostname.endsWith(suffix) && url.hostname.length > suffix.length);
}
