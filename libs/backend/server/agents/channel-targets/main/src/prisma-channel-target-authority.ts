import { ChannelInvocationAction, ConversationLifecycle, ConversationMode, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace, ___GetActiveSpan } from "@opencrane/backend/observability";

import type { ChannelConversationAuthority, ChannelTargetAuthorityRepository, ChannelTargetAuthorityUnitOfWork, ConsumeChannelInvocationContextCommand, ConsumeChannelInvocationContextResult, IssueChannelInvocationContextCommand, IssueChannelInvocationContextResult, ReconcileChannelRuntimeRoutesCommand } from "./channel-target-resolution.types.js";

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

/**
 * The Prisma-backed channel authority: one serializable transaction per operation.
 *
 * Serializable is chosen deliberately. Issuing and spending an invocation context both re-read the
 * conversation, its participants and the route and then write, and at a weaker isolation level a
 * concurrent close, participant removal, or route swap could slip between the read and the write.
 * Each operation is traced and its outcome recorded on the span, so a refusal can be explained
 * afterwards without ever logging the opaque context itself.
 *
 * Called by: apps/opencrane/src/app/channel-target-composition.ts and
 * apps/opencrane/src/app/runtime-composition.ts.
 *
 * @see {@link ChannelTargetAuthorityUnitOfWork} the port this satisfies.
 */
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

	/** Reconciles one stable receiver into distinct service-owned route rows at process startup. */
	async reconcileRuntimeRoutes(command: ReconcileChannelRuntimeRoutesCommand): Promise<number>
	{
		if (!command.receiverId.trim() || !_endpointIsAllowed(command.endpoint, command.allowedRouteHostSuffixes))
		{
			throw new Error("channel runtime receiver configuration is invalid");
		}
		const self = this;
		return ___DoWithTrace("channel.routes.reconcile", {}, async function _ReconcileRoutes()
		{
			const count = await self._withRepository(function _Reconcile(repository) { return repository.reconcileRuntimeRoutes(command); });
			___GetActiveSpan()?.setAttribute("route_count", count);
			return count;
		});
	}

	/** Re-reads the conversation, participants and route inside the transaction, then stores only the context's digest. */
	async issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>
	{
		const self = this;
		return ___DoWithTrace("channel.context.issue", {}, async function _IssueContext()
		{
			const result = await self._withRepository(function _Issue(repository) { return repository.issueInvocationContextAtomically(command); });
			___GetActiveSpan()?.setAttribute("outcome", result.status);
			return result;
		});
	}

	/** Consumes one digest while requiring the stable receiver and exact active service route. */
	async consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>
	{
		const self = this;
		return ___DoWithTrace("channel.context.consume", {}, async function _ConsumeContext()
		{
			const result = await self._withRepository(function _Consume(repository) { return repository.consumeInvocationContextAtomically(command); });
			___GetActiveSpan()?.setAttribute("outcome", result.status);
			return result;
		});
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

	/** Reconciles the configured receiver and retires any previously current receiver atomically. */
	async reconcileRuntimeRoutes(command: ReconcileChannelRuntimeRoutesCommand): Promise<number>
	{
		const services = await this.transaction.agentService.findMany({ select: { id: true, siloId: true } });
		const registeredAt = new Date();
		for (const service of services)
		{
			await this.transaction.channelRuntimeRoute.updateMany({
				where: { siloId: service.siloId, agentServiceId: service.id, action: ChannelInvocationAction.EventsRead, isCurrent: true, receiverId: { not: command.receiverId } },
				data: { isCurrent: false, revokedAt: registeredAt },
			});
			await this.transaction.channelRuntimeRoute.upsert({
				where: { receiverId_siloId_agentServiceId_action: { receiverId: command.receiverId, siloId: service.siloId, agentServiceId: service.id, action: ChannelInvocationAction.EventsRead } },
				create: { receiverId: command.receiverId, siloId: service.siloId, agentServiceId: service.id, action: ChannelInvocationAction.EventsRead, endpoint: command.endpoint },
				update: { endpoint: command.endpoint, isCurrent: true, revokedAt: null, registeredAt },
			});
		}
		return services.length;
	}

	/** Re-reads the conversation, participants and route inside the transaction, then stores only the context's digest. */
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
			where: { receiverId: command.receiverId, siloId: command.siloId, agentServiceId: command.agentServiceId, action: ChannelInvocationAction.EventsRead, isCurrent: true, revokedAt: null },
			take: 2,
		});
		if (routes.length === 0) return { status: "route_unavailable" } as const;
		if (routes.length !== 1) return { status: "route_ambiguous" } as const;
		const route = routes[0]!;
		if (!_endpointIsAllowed(route.endpoint, command.allowedRouteHostSuffixes)) return { status: "route_unavailable" } as const;

		const context = await this.transaction.channelInvocationContext.create({
			data: {
				digest: command.digest,
				subjectId: command.subjectId,
				siloId: command.siloId,
				conversationId: command.conversationId,
				agentServiceId: command.agentServiceId,
				action: ChannelInvocationAction.EventsRead,
				routeId: route.id,
				receiverId: route.receiverId,
				membershipRevision: command.membershipRevision,
				authorizationDigest: command.authorizationDigest,
				expiresAt: new Date(command.expiresAtEpochMs),
			},
		});
		return { status: "issued", context: { id: context.id, routeId: route.id, receiverId: route.receiverId, endpoint: route.endpoint } } as const;
	}

	/** Consumes one digest while requiring the stable receiver and exact active service route. */
	async consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>
	{
		const context = await this.transaction.channelInvocationContext.findUnique({ where: { digest: command.digest }, include: { route: true } });
		if (context === null) return { status: "denied", reason: "not_found" } as const;
		if (context.receiverId !== command.expectedReceiverId || context.route.receiverId !== command.expectedReceiverId) return { status: "denied", reason: "receiver_mismatch" } as const;
		if (context.route.id !== context.routeId || context.route.siloId !== context.siloId || context.route.agentServiceId !== context.agentServiceId || context.route.action !== context.action) return { status: "denied", reason: "route_mismatch" } as const;
		if (context.revokedAt !== null) return { status: "denied", reason: "revoked" } as const;
		if (context.consumedAt !== null) return { status: "denied", reason: "replayed" } as const;
		if (context.expiresAt.getTime() <= command.nowEpochMs) return { status: "denied", reason: "expired" } as const;
		if (context.action !== ChannelInvocationAction.EventsRead || !context.route.isCurrent || context.route.revokedAt !== null) return { status: "denied", reason: "route_inactive" } as const;

		const consumed = await this.transaction.channelInvocationContext.updateMany({ where: { id: context.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date(command.nowEpochMs) } }, data: { consumedAt: new Date(command.nowEpochMs) } });
		if (consumed.count !== 1) return { status: "denied", reason: "replayed" } as const;
		return {
			status: "consumed",
			context: {
				routeId: context.routeId,
				receiverId: context.receiverId,
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
