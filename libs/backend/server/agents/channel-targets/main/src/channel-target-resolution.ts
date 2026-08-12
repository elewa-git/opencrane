import { randomBytes } from "node:crypto";

import { __AuthorizeConversationRead } from "./conversation-read-authorization.js";
import { __DigestChannelInvocationContext } from "./channel-invocation-context-digest.js";
import type { AuthorizedChannelTargetResult, ChannelOpaqueContextSource, ChannelTargetClock, ChannelTargetResolutionDependencies, ResolveChannelTargetCommand, ResolveChannelTargetResult } from "./channel-target-resolution.types.js";

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

/**
 * Decide whether one browser, proxied by channel-proxy, may read events on one conversation - and where.
 *
 * The seven numbered checks below run in a fixed order, cheapest and most sceptical first: validate
 * the request and the resolver's own configuration, confirm the calling workload with a Kubernetes
 * TokenReview, require a human subject that OpenCrane itself verified, bind the already
 * origin-checked host to a silo and current signed membership, require an open agent session the
 * subject participates in, authorize the read, and only then mint a short-lived opaque pass. Each
 * stage fails closed with its own reason. The pass is returned to the proxy in full but stored only
 * as a digest, and the final database call re-checks every binding inside one serializable
 * transaction, because the conversation or the route can change while the earlier checks run.
 *
 * Called by: the POST handler in channel-targets.router.ts, which serves
 * /api/internal/channel-targets:resolve.
 *
 * @param dependencies - Fixed policy plus the identity, membership, conversation, and route authorities.
 * @param command - The request assembled by the router; never raw browser input.
 * @returns `authorized` with the endpoint, opaque context and expiry, or `denied` with the reason
 * that decides the router's status code.
 */
export async function __ResolveChannelTarget(dependencies: ChannelTargetResolutionDependencies, command: ResolveChannelTargetCommand): Promise<ResolveChannelTargetResult>
{
	const nowEpochMs = dependencies.clock.nowEpochMs();

	// 1. Reject incomplete or unsafe inputs before querying any identity authority.
	if (!_commandIsValid(command) || !_configIsValid(dependencies, nowEpochMs))
	{
		return { outcome: "denied", reason: "invalid_request" };
	}

	// 2. TokenReview the channel-proxy token and require the exact audience, KSA, namespace, and username.
	const workload = await dependencies.workloadIdentity.__Review(command.workloadToken);
	const expectedUsername = `system:serviceaccount:${dependencies.config.channelProxyNamespace}:${dependencies.config.channelProxyServiceAccountName}`;
	if (workload === null
		|| workload.serviceAccountName !== dependencies.config.channelProxyServiceAccountName
		|| workload.namespace !== dependencies.config.channelProxyNamespace
		|| workload.username !== expectedUsername
		|| !workload.audiences.includes(dependencies.config.workloadAudience))
	{
		return { outcome: "denied", reason: "workload_denied" };
	}

	// 3. Require the human subject already verified by the shared OpenCrane session middleware.
	if (!command.delegatedIdentity.trustworthySubject || command.delegatedIdentity.source !== "cookie" || !command.delegatedIdentity.subjectId.trim())
	{
		return { outcome: "denied", reason: "identity_denied" };
	}
	const subjectId = command.delegatedIdentity.subjectId;

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

	// 5. Require an open agent session bound to the same silo, service, and explicit participant.
	const conversation = await dependencies.repository.getConversationAuthority(command.conversationId);
	if (conversation === null || conversation.mode !== "agent_session" || conversation.lifecycle !== "open" || conversation.siloId !== hostBinding.siloId || !conversation.agentServiceId.trim())
	{
		return { outcome: "denied", reason: "conversation_denied" };
	}

	// 6. Authorize the event-read action without manufacturing command or run authority.
	const authorization = __AuthorizeConversationRead(conversation, {
		subjectId,
		siloId: hostBinding.siloId,
		conversationId: conversation.conversationId,
		agentServiceId: conversation.agentServiceId,
		scope: hostBinding.authorizationScope,
		requiredActions: ["conversation.read"],
		membershipRevision: membership.revision,
		nowEpochMs,
	});
	if (authorization.outcome !== "allowed" || !/^sha256:[0-9a-f]{64}$/u.test(authorization.authorizationDigest))
	{
		return { outcome: "denied", reason: "authorization_denied" };
	}

	// 7. Generate an opaque context, persist only its digest, and atomically recheck every DB binding.
	const invocationContext = dependencies.opaqueContext.create();
	if (!/^[A-Za-z0-9_-]{43,}$/u.test(invocationContext))
	{
		return { outcome: "denied", reason: "route_denied" };
	}
	const digest = __DigestChannelInvocationContext(invocationContext);
	const expiresAtEpochMs = Math.min(nowEpochMs + dependencies.config.invocationContextTtlMs, membership.trustedUntilEpochMs);
	if (expiresAtEpochMs <= nowEpochMs)
	{
		return { outcome: "denied", reason: "membership_denied" };
	}
	const issued = await dependencies.repository.issueInvocationContextAtomically({ digest, subjectId, siloId: hostBinding.siloId, conversationId: conversation.conversationId, agentServiceId: conversation.agentServiceId, action: command.action, membershipRevision: membership.revision, authorizationDigest: authorization.authorizationDigest, nowEpochMs, expiresAtEpochMs, allowedRouteHostSuffixes: dependencies.config.allowedRouteHostSuffixes, receiverId: dependencies.config.receiverId });
	if (issued.status !== "issued" || !_endpointIsAllowed(issued.context.endpoint, dependencies.config.allowedRouteHostSuffixes))
	{
		return { outcome: "denied", reason: "route_denied" };
	}

	const target: AuthorizedChannelTargetResult = { subjectId, endpoint: issued.context.endpoint, invocationContext, expiresAt: new Date(expiresAtEpochMs).toISOString() };
	return { outcome: "authorized", target };
}

/** Validates target-neutral request structure without interpreting credentials. */
function _commandIsValid(command: ResolveChannelTargetCommand): boolean
{
	return command.workloadToken.trim().length > 0
		&& /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/u.test(command.trustedHost)
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(command.conversationId)
		&& command.action === "events.read"
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
		&& dependencies.config.allowedRouteHostSuffixes.every(suffix => suffix.startsWith(".") && suffix.length > 1)
		&& dependencies.config.receiverId.trim().length > 0
		&& _endpointIsAllowed(dependencies.config.receiverEndpoint, dependencies.config.allowedRouteHostSuffixes);
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
