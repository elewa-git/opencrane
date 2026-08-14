import { randomUUID } from "node:crypto";

import { AgentRunState, AgentThreadDeliveryKind, WorkloadAssignmentState, type Prisma } from "@prisma/client";

import { AgentThreadDeliveryKinds, type AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";

import type { AgentThreadParentDeliveryCommand, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types.js";
import type { AgentThreadParentDeliveryRepository } from "./prisma-agent-thread-parent-delivery-repository.types.js";

/** Maps the internal delivery vocabulary to its stored Prisma values. */
const _KIND: Readonly<Record<AgentThreadDeliveryKinds, AgentThreadDeliveryKind>> = {
	[AgentThreadDeliveryKinds.Status]: AgentThreadDeliveryKind.Status,
	[AgentThreadDeliveryKinds.Question]: AgentThreadDeliveryKind.Question,
	[AgentThreadDeliveryKinds.Approval]: AgentThreadDeliveryKind.Approval,
	[AgentThreadDeliveryKinds.Result]: AgentThreadDeliveryKind.Result,
	[AgentThreadDeliveryKinds.Failure]: AgentThreadDeliveryKind.Failure,
	[AgentThreadDeliveryKinds.Asset]: AgentThreadDeliveryKind.Asset,
};

/** Maps stored Prisma delivery values back to the internal delivery vocabulary. */
const _PUBLIC_KIND: Readonly<Record<AgentThreadDeliveryKind, AgentThreadDeliveryKinds>> = {
	[AgentThreadDeliveryKind.Status]: AgentThreadDeliveryKinds.Status,
	[AgentThreadDeliveryKind.Question]: AgentThreadDeliveryKinds.Question,
	[AgentThreadDeliveryKind.Approval]: AgentThreadDeliveryKinds.Approval,
	[AgentThreadDeliveryKind.Result]: AgentThreadDeliveryKinds.Result,
	[AgentThreadDeliveryKind.Failure]: AgentThreadDeliveryKinds.Failure,
	[AgentThreadDeliveryKind.Asset]: AgentThreadDeliveryKinds.Asset,
};

/**
 * Resolves runtime and thread authority, then persists the parent delivery validated by the unit
 * of work.
 *
 * The constructor accepts a Prisma transaction client, never the process client, so assignment,
 * immediate-parent, idempotency, and insert decisions share the unit of work's serializable
 * snapshot. The class stays internal to the conversations package.
 *
 * Called by: `PrismaAgentThreadParentDeliveryUnitOfWork.deliver`.
 */
export class PrismaAgentThreadParentDeliveryRepository implements AgentThreadParentDeliveryRepository
{
	/** Prisma transaction used by every authority read and delivery write. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds all delivery persistence to the transaction opened by the unit of work. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/**
	 * Appends or replays one delivery after proving the active assignment and immediate parent.
	 *
	 * A registered workload remains authoritative only while its lease is current, its run is
	 * running on the same attempt, and the requested child still belongs to that agent service. An
	 * idempotency replay succeeds only when every stored delivery coordinate and display field still
	 * matches the request.
	 *
	 * Called by: `PrismaAgentThreadParentDeliveryUnitOfWork.deliver`.
	 *
	 * @param identity - Runtime identity derived from the reviewed workload token.
	 * @param command - Display-safe delivery coordinates and idempotency key.
	 * @returns An accepted delivery, its identical replay, or a fail-closed denial.
	 * @throws When Prisma cannot complete a delegate call; the unit of work maps that failure.
	 */
	async deliver(identity: AgentThreadRuntimeIdentity, command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>
	{
		const assignment = await this.transaction.workloadAssignment.findFirst({ where: { runId: command.runId, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, podUid: identity.podUid, state: WorkloadAssignmentState.Registered, expiresAt: { gt: new Date() }, run: { state: AgentRunState.Running } }, select: { siloId: true, agentServiceId: true, attempt: true, run: { select: { attempt: true } } } });
		if (assignment === null || assignment.attempt !== assignment.run.attempt) return { outcome: "denied", reason: "authority_unavailable" };

		const thread = await this.transaction.conversationAgentThread.findFirst({ where: { childConversationId: command.childConversationId, siloId: assignment.siloId, agentServiceId: assignment.agentServiceId, childConversation: { lifecycle: "Open" } }, select: { parentConversationId: true } });
		if (thread === null) return { outcome: "denied", reason: "authority_unavailable" };

		const existing = await this.transaction.agentThreadParentDelivery.findUnique({ where: { childConversationId_idempotencyKey: { childConversationId: command.childConversationId, idempotencyKey: command.idempotencyKey } } });
		if (existing !== null) return _matches(existing, command, assignment.agentServiceId, thread.parentConversationId) ? { outcome: "idempotent", delivery: _view(existing) } : { outcome: "denied", reason: "idempotency_conflict" };

		const delivery = await this.transaction.agentThreadParentDelivery.create({ data: { id: randomUUID(), childConversationId: command.childConversationId, parentConversationId: thread.parentConversationId, siloId: assignment.siloId, agentServiceId: assignment.agentServiceId, runId: command.runId, idempotencyKey: command.idempotencyKey, kind: _KIND[command.kind], label: command.label, detail: command.detail, assetId: command.assetId } });
		return { outcome: "accepted", delivery: _view(delivery) };
	}
}

/** Checks whether a stored delivery is the same request rather than a reused idempotency key. */
function _matches(row: { runId: string; parentConversationId: string; agentServiceId: string; kind: AgentThreadDeliveryKind; label: string; detail: string; assetId: string | null }, command: AgentThreadParentDeliveryCommand, agentServiceId: string, parentConversationId: string): boolean
{
	return row.runId === command.runId && row.parentConversationId === parentConversationId && row.agentServiceId === agentServiceId && row.kind === _KIND[command.kind] && row.label === command.label && row.detail === command.detail && row.assetId === command.assetId;
}

/** Maps one stored delivery to the package's display-safe view. */
function _view(row: { id: string; childConversationId: string; parentConversationId: string; runId: string; kind: AgentThreadDeliveryKind; label: string; detail: string; assetId: string | null; createdAt: Date }): AgentThreadParentDelivery
{
	return { id: row.id, childConversationId: row.childConversationId, parentConversationId: row.parentConversationId, runId: row.runId, kind: _PUBLIC_KIND[row.kind], label: row.label, detail: row.detail, assetId: row.assetId, createdAt: row.createdAt.toISOString() };
}
