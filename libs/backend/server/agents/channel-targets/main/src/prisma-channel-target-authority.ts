import { AgentRunState, AgentRunTrigger, ChannelInvocationAction, Prisma, type PrismaClient } from "@prisma/client";

import type { ChannelResolutionAction, ChannelTargetAuthorityRepository, ChannelThreadAuthority, ConsumeChannelInvocationContextCommand, ConsumeChannelInvocationContextResult, IssueChannelInvocationContextCommand, IssueChannelInvocationContextResult } from "./channel-target-resolution.types.js";

/** Maps the target-neutral channel action to its Prisma enum. */
function _prismaAction(action: ChannelResolutionAction): ChannelInvocationAction
{
	return action === "command.forward" ? ChannelInvocationAction.CommandForward : ChannelInvocationAction.EventsRead;
}

/** Maps the persisted Prisma action to its target-neutral value. */
function _domainAction(action: ChannelInvocationAction): ChannelResolutionAction
{
	return action === ChannelInvocationAction.CommandForward ? "command.forward" : "events.read";
}

/** Returns true only while an interactive run can still receive command authority. */
function _runCanReceiveCommand(trigger: AgentRunTrigger, state: AgentRunState): boolean
{
	return trigger === AgentRunTrigger.Interactive
		&& (state === AgentRunState.Accepted
			|| state === AgentRunState.Queued
			|| state === AgentRunState.Assigned
			|| state === AgentRunState.Running
			|| state === AgentRunState.WaitingForApproval);
}

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

/** Prisma-backed atomic authority for thread-bound channel routes and opaque contexts. */
export class PrismaChannelTargetAuthorityRepository implements ChannelTargetAuthorityRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;

	/** Creates the authority adapter over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads current thread coordinates and explicit participants. */
	async getThreadAuthority(threadId: string): Promise<ChannelThreadAuthority | null>
	{
		const row = await this.prisma.conversationThread.findUnique({ where: { id: threadId }, include: { participants: true } });
		if (row === null) return null;
		return { threadId: row.id, siloId: row.siloId, agentServiceId: row.agentServiceId, state: row.state === "Active" ? "active" : "archived", participantUserIds: row.participants.map(participant => participant.userId) };
	}

	/** Rechecks every mutable authority coordinate while persisting only the opaque digest. */
	async issueInvocationContextAtomically(command: IssueChannelInvocationContextCommand): Promise<IssueChannelInvocationContextResult>
	{
		return this.prisma.$transaction(async function _issue(transaction: Prisma.TransactionClient)
		{
			// 1. Lock and re-read the thread so archival, participant, silo, and service changes cannot race issuance.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "conversation_threads" WHERE "id" = ${command.threadId} FOR UPDATE`);
			const thread = await transaction.conversationThread.findUnique({ where: { id: command.threadId }, include: { participants: true } });
			if (thread === null || thread.state !== "Active" || thread.siloId !== command.siloId || thread.agentServiceId !== command.agentServiceId)
			{
				return { status: "thread_conflict" } as const;
			}
			if (!thread.participants.some(participant => participant.userId === command.subjectId))
			{
				return { status: "participant_conflict" } as const;
			}

			// 2. Bind commands to a real durable run; event reads intentionally have no invented run.
			if (command.action === "command.forward")
			{
				if (command.runId === null) return { status: "run_conflict" } as const;
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
				const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
				if (run === null || run.siloId !== command.siloId || run.threadId !== command.threadId || run.agentServiceId !== command.agentServiceId || run.delegatedUserId !== command.subjectId || !_runCanReceiveCommand(run.trigger, run.state))
				{
					return { status: "run_conflict" } as const;
				}
			}
			else if (command.runId !== null)
			{
				return { status: "run_conflict" } as const;
			}

			// 3. Lock the controller-selected route and insert only if it is unique, current, unexpired, and internal.
			const prismaAction = _prismaAction(command.action);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "channel_runtime_routes" WHERE "silo_id" = ${command.siloId} AND "agent_service_id" = ${command.agentServiceId} AND "action" = CAST(${command.action} AS "ChannelInvocationAction") AND "is_current" = TRUE AND "revoked_at" IS NULL AND "expires_at" > ${new Date(command.nowEpochMs)} FOR UPDATE`);
			const routes = await transaction.channelRuntimeRoute.findMany({ where: { siloId: command.siloId, agentServiceId: command.agentServiceId, action: prismaAction, isCurrent: true, revokedAt: null, expiresAt: { gt: new Date(command.nowEpochMs) } }, take: 2 });
			if (routes.length === 0) return { status: "route_unavailable" } as const;
			if (routes.length !== 1) return { status: "route_ambiguous" } as const;
			const route = routes[0]!;
			if (!_endpointIsAllowed(route.endpoint, command.allowedRouteHostSuffixes) || route.expiresAt.getTime() < command.expiresAtEpochMs)
			{
				return { status: "route_unavailable" } as const;
			}
			const context = await transaction.channelInvocationContext.create({ data: { digest: command.digest, subjectId: command.subjectId, siloId: command.siloId, threadId: command.threadId, agentServiceId: command.agentServiceId, action: prismaAction, routeId: route.id, runId: command.runId, membershipRevision: command.membershipRevision, authorizationDigest: command.authorizationDigest, expiresAt: new Date(command.expiresAtEpochMs) } });
			return { status: "issued", context: { id: context.id, routeId: route.id, endpoint: route.endpoint } } as const;
		});
	}

	/** Consumes a digest once while requiring the receiving runtime's exact active route. */
	async consumeInvocationContextAtomically(command: ConsumeChannelInvocationContextCommand): Promise<ConsumeChannelInvocationContextResult>
	{
		return this.prisma.$transaction(async function _consume(transaction: Prisma.TransactionClient)
		{
			// 1. Lock the digest row so concurrent PEP exchanges serialize to one winner.
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "channel_invocation_contexts" WHERE "digest" = ${command.digest} FOR UPDATE`);
			await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "channel_runtime_routes" WHERE "id" = ${command.expectedRouteId} FOR UPDATE`);
			const context = await transaction.channelInvocationContext.findUnique({ where: { digest: command.digest }, include: { route: true } });
			if (context === null) return { status: "denied", reason: "not_found" } as const;

			// 2. Recheck context and registered-route lifetime online rather than trusting bearer contents.
			if (context.routeId !== command.expectedRouteId) return { status: "denied", reason: "route_mismatch" } as const;
			if (context.revokedAt !== null) return { status: "denied", reason: "revoked" } as const;
			if (context.consumedAt !== null) return { status: "denied", reason: "replayed" } as const;
			if (context.expiresAt.getTime() <= command.nowEpochMs) return { status: "denied", reason: "expired" } as const;
			if (!context.route.isCurrent || context.route.revokedAt !== null || context.route.expiresAt.getTime() <= command.nowEpochMs) return { status: "denied", reason: "route_inactive" } as const;
			if (context.action === ChannelInvocationAction.CommandForward)
			{
				if (context.runId === null) return { status: "denied", reason: "run_inactive" } as const;
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${context.runId} FOR UPDATE`);
				const run = await transaction.agentRun.findUnique({ where: { id: context.runId } });
				if (run === null || run.siloId !== context.siloId || run.threadId !== context.threadId || run.agentServiceId !== context.agentServiceId || run.delegatedUserId !== context.subjectId || !_runCanReceiveCommand(run.trigger, run.state))
				{
					return { status: "denied", reason: "run_inactive" } as const;
				}
			}

			// 3. Mark the context consumed before returning its bound authority to the runtime PEP.
			await transaction.channelInvocationContext.update({ where: { id: context.id }, data: { consumedAt: new Date(command.nowEpochMs) } });
			return { status: "consumed", context: { subjectId: context.subjectId, siloId: context.siloId, threadId: context.threadId, agentServiceId: context.agentServiceId, action: _domainAction(context.action), runId: context.runId, authorizationDigest: context.authorizationDigest } } as const;
		});
	}
}
