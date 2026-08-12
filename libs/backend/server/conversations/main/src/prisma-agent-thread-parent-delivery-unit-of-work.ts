import { randomUUID } from "node:crypto";

import { AgentThreadDeliveryKind, Prisma, WorkloadAssignmentState, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { AgentThreadDeliveryKinds, type AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";
import { ___CreateLogger, ___DoWithTrace } from "@opencrane/backend/observability";

import type { AgentThreadParentDeliveryCommand, AgentThreadParentDeliveryUnitOfWork, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types.js";

const _KIND: Readonly<Record<AgentThreadDeliveryKinds, AgentThreadDeliveryKind>> = {
	[AgentThreadDeliveryKinds.Status]: AgentThreadDeliveryKind.Status,
	[AgentThreadDeliveryKinds.Question]: AgentThreadDeliveryKind.Question,
	[AgentThreadDeliveryKinds.Approval]: AgentThreadDeliveryKind.Approval,
	[AgentThreadDeliveryKinds.Result]: AgentThreadDeliveryKind.Result,
	[AgentThreadDeliveryKinds.Failure]: AgentThreadDeliveryKind.Failure,
	[AgentThreadDeliveryKinds.Asset]: AgentThreadDeliveryKind.Asset,
};
const _PUBLIC_KIND: Readonly<Record<AgentThreadDeliveryKind, AgentThreadDeliveryKinds>> = {
	[AgentThreadDeliveryKind.Status]: AgentThreadDeliveryKinds.Status,
	[AgentThreadDeliveryKind.Question]: AgentThreadDeliveryKinds.Question,
	[AgentThreadDeliveryKind.Approval]: AgentThreadDeliveryKinds.Approval,
	[AgentThreadDeliveryKind.Result]: AgentThreadDeliveryKinds.Result,
	[AgentThreadDeliveryKind.Failure]: AgentThreadDeliveryKinds.Failure,
	[AgentThreadDeliveryKind.Asset]: AgentThreadDeliveryKinds.Asset,
};

/** Persists runtime-authored display-safe deliveries and their parent timeline append atomically. */
export class PrismaAgentThreadParentDeliveryUnitOfWork implements AgentThreadParentDeliveryUnitOfWork
{
	constructor(private readonly prisma: PrismaClient, private readonly logger: Logger = ___CreateLogger("agent-thread-parent-delivery")) {}

	async deliver(identity: AgentThreadRuntimeIdentity, command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>
	{
		return ___DoWithTrace("conversation.agent_thread.parent_delivery", { conversationId: command.childConversationId, runId: command.runId }, async () =>
		{
			if (!_valid(command)) return { outcome: "denied", reason: "invalid_display_content" };
			try
			{
				return await this.prisma.$transaction(async function _Deliver(transaction): Promise<DeliverAgentThreadParentResult>
				{
					const assignment = await transaction.workloadAssignment.findFirst({ where: { runId: command.runId, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, podUid: identity.podUid, state: WorkloadAssignmentState.Registered, expiresAt: { gt: new Date() } }, select: { siloId: true, agentServiceId: true } });
					if (assignment === null) return { outcome: "denied", reason: "authority_unavailable" };
					const thread = await transaction.conversationAgentThread.findFirst({ where: { childConversationId: command.childConversationId, siloId: assignment.siloId, agentServiceId: assignment.agentServiceId, childConversation: { lifecycle: "Open" } }, select: { parentConversationId: true } });
					if (thread === null) return { outcome: "denied", reason: "authority_unavailable" };
					const existing = await transaction.agentThreadParentDelivery.findUnique({ where: { childConversationId_idempotencyKey: { childConversationId: command.childConversationId, idempotencyKey: command.idempotencyKey } } });
					if (existing !== null) return _matches(existing, command, assignment.agentServiceId, thread.parentConversationId) ? { outcome: "idempotent", delivery: _view(existing) } : { outcome: "denied", reason: "idempotency_conflict" };
					const delivery = await transaction.agentThreadParentDelivery.create({ data: { id: randomUUID(), childConversationId: command.childConversationId, parentConversationId: thread.parentConversationId, siloId: assignment.siloId, agentServiceId: assignment.agentServiceId, runId: command.runId, idempotencyKey: command.idempotencyKey, kind: _KIND[command.kind], label: command.label, detail: command.detail, assetId: command.assetId } });
					return { outcome: "accepted", delivery: _view(delivery) };
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (err)
			{
				this.logger.error({ err, conversationId: command.childConversationId, runId: command.runId, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, podUid: identity.podUid }, "Agent-thread parent delivery persistence failed");
				return { outcome: "denied", reason: "persistence_unavailable" };
			}
		});
	}
}

function _valid(command: AgentThreadParentDeliveryCommand): boolean
{
	return command.idempotencyKey.trim().length > 0 && command.idempotencyKey.length <= 128
		&& command.label.trim().length > 0 && command.label.length <= 160
		&& command.detail.trim().length > 0 && command.detail.length <= 4000
		&& (command.kind === AgentThreadDeliveryKinds.Asset ? command.assetId !== null : command.assetId === null);
}

function _matches(row: { runId: string; parentConversationId: string; agentServiceId: string; kind: AgentThreadDeliveryKind; label: string; detail: string; assetId: string | null }, command: AgentThreadParentDeliveryCommand, agentServiceId: string, parentConversationId: string): boolean
{
	return row.runId === command.runId && row.parentConversationId === parentConversationId && row.agentServiceId === agentServiceId && row.kind === _KIND[command.kind] && row.label === command.label && row.detail === command.detail && row.assetId === command.assetId;
}

function _view(row: { id: string; childConversationId: string; parentConversationId: string; runId: string; kind: AgentThreadDeliveryKind; label: string; detail: string; assetId: string | null; createdAt: Date }): AgentThreadParentDelivery
{
	return { id: row.id, childConversationId: row.childConversationId, parentConversationId: row.parentConversationId, runId: row.runId, kind: _PUBLIC_KIND[row.kind], label: row.label, detail: row.detail, assetId: row.assetId, createdAt: row.createdAt.toISOString() };
}
