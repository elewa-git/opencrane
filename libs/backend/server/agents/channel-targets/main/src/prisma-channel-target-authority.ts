import { ChannelInvocationAction, ConversationLifecycle, ConversationMode, Prisma, type PrismaClient } from "@prisma/client";

import type { ChannelConversationAuthority, ChannelTargetAuthorityRepository, ChannelTargetAuthorityUnitOfWork, ConsumeChannelInvocationContextCommand, ConsumeChannelInvocationContextResult, IssueChannelInvocationContextCommand, IssueChannelInvocationContextResult } from "./channel-target-resolution.types.js";

/** Accepts only credential-free HTTP(S) endpoints inside configured runtime DNS suffixes. */
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
		&& allowedSuffixes.some(suffix => suffix.startsWith(".") && url.hostname.endsWith(suffix) && url.hostname.length > suffix.length);
}

/** Prisma unit of work that supplies one transaction snapshot to each channel authority operation. */
export class PrismaChannelTargetAuthorityUnitOfWork implements ChannelTargetAuthorityUnitOfWork
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;

	/** Creates the authority adapter over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads current agent-session coordinates and participants without manufacturing write authority. */
	async getConversationAuthority(conversationId: string): Promise<ChannelConversationAuthority | null>
	{
		return this._withRepository(function _Read(repository) { return repository.getConversationAuthority(conversationId); });
	}

	/** Rechecks every mutable authority coordinate while persisting only the opaque digest. */
	async issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>
	{
		return this._withRepository(function _Issue(repository) { return repository.issueInvocationContextAtomically(command); });
	}

	/** Consumes one digest while requiring the receiving runtime's exact active event route. */
	async consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>
	{
		return this._withRepository(function _Consume(repository) { return repository.consumeInvocationContextAtomically(command); });
	}

	/** Runs one authority operation against an exact serializable transaction snapshot. */
	private async _withRepository<T>(operation: (repository: ChannelTargetAuthorityRepository) => Promise<T>): Promise<T>
	{
		return this.prisma.$transaction(async function _WithRepository(transaction: Prisma.TransactionClient)
		{
			return operation(new PrismaChannelTargetAuthorityTransactionRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Transaction-scoped repository for conversation-bound event routes and opaque contexts. */
class PrismaChannelTargetAuthorityTransactionRepository implements ChannelTargetAuthorityRepository
{
	/** Exact transaction snapshot supplied by the owning unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the repository over one transaction snapshot. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Loads current agent-session coordinates and participants without manufacturing write authority. */
	async getConversationAuthority(conversationId: string): Promise<ChannelConversationAuthority | null>
	{
		const row = await this.transaction.conversation.findUnique({ where: { id: conversationId }, include: { participants: true } });
		if (row === null || row.mode !== ConversationMode.AgentSession || row.agentServiceId === null) return null;
		return {
			conversationId: row.id,
			siloId: row.siloId,
			agentServiceId: row.agentServiceId,
			mode: "agent_session",
			lifecycle: row.lifecycle === ConversationLifecycle.Open ? "open" : "closed",
			participantUserIds: row.participants.filter(participant => participant.accessEndedPosition === null).map(participant => participant.userId),
		};
	}

	/** Rechecks every mutable authority coordinate while persisting only the opaque digest. */
	async issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>
	{
		const conversation = await this.transaction.conversation.findUnique({ where: { id: command.conversationId }, include: { participants: true } });
		if (conversation === null
			|| conversation.mode !== ConversationMode.AgentSession
			|| conversation.lifecycle !== ConversationLifecycle.Open
			|| conversation.siloId !== command.siloId
			|| conversation.agentServiceId !== command.agentServiceId)
		{
			return { status: "conversation_conflict" } as const;
		}
		if (!conversation.participants.some(participant => participant.userId === command.subjectId && participant.accessEndedPosition === null))
		{
			return { status: "participant_conflict" } as const;
		}

		const routes = await this.transaction.channelRuntimeRoute.findMany({
			where: { siloId: command.siloId, agentServiceId: command.agentServiceId, action: ChannelInvocationAction.EventsRead, isCurrent: true, revokedAt: null, expiresAt: { gt: new Date(command.nowEpochMs) } },
			take: 2,
		});
		if (routes.length === 0) return { status: "route_unavailable" } as const;
		if (routes.length !== 1) return { status: "route_ambiguous" } as const;
		const route = routes[0]!;
		if (!_endpointIsAllowed(route.endpoint, command.allowedRouteHostSuffixes) || route.expiresAt.getTime() < command.expiresAtEpochMs)
		{
			return { status: "route_unavailable" } as const;
		}
		const context = await this.transaction.channelInvocationContext.create({
			data: {
				digest: command.digest,
				subjectId: command.subjectId,
				siloId: command.siloId,
				conversationId: command.conversationId,
				agentServiceId: command.agentServiceId,
				action: ChannelInvocationAction.EventsRead,
				routeId: route.id,
				membershipRevision: command.membershipRevision,
				authorizationDigest: command.authorizationDigest,
				expiresAt: new Date(command.expiresAtEpochMs),
			},
		});
		return { status: "issued", context: { id: context.id, routeId: route.id, endpoint: route.endpoint } } as const;
	}

	/** Consumes one digest while requiring the receiving runtime's exact active event route. */
	async consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>
	{
		const context = await this.transaction.channelInvocationContext.findUnique({ where: { digest: command.digest }, include: { route: true } });
		if (context === null) return { status: "denied", reason: "not_found" } as const;
		if (context.routeId !== command.expectedRouteId) return { status: "denied", reason: "route_mismatch" } as const;
		if (context.revokedAt !== null) return { status: "denied", reason: "revoked" } as const;
		if (context.consumedAt !== null) return { status: "denied", reason: "replayed" } as const;
		if (context.expiresAt.getTime() <= command.nowEpochMs) return { status: "denied", reason: "expired" } as const;
		if (context.action !== ChannelInvocationAction.EventsRead || !context.route.isCurrent || context.route.revokedAt !== null || context.route.expiresAt.getTime() <= command.nowEpochMs)
		{
			return { status: "denied", reason: "route_inactive" } as const;
		}

		const consumed = await this.transaction.channelInvocationContext.updateMany({ where: { id: context.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date(command.nowEpochMs) } }, data: { consumedAt: new Date(command.nowEpochMs) } });
		if (consumed.count !== 1) return { status: "denied", reason: "replayed" } as const;
		return {
			status: "consumed",
			context: {
				subjectId: context.subjectId,
				siloId: context.siloId,
				conversationId: context.conversationId,
				agentServiceId: context.agentServiceId,
				action: "events.read",
				authorizationDigest: context.authorizationDigest,
			},
		} as const;
	}
}
