import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";
import { ___CreateLogger, ___DoWithTrace } from "@opencrane/backend/observability";

import type { AgentThreadParentDeliveryCommand, AgentThreadParentDeliveryUnitOfWork, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types.js";
import { PrismaAgentThreadParentDeliveryRepository } from "./prisma-agent-thread-parent-delivery-repository.js";

/** Persists runtime-authored display-safe deliveries and their parent timeline append atomically. */
export class PrismaAgentThreadParentDeliveryUnitOfWork implements AgentThreadParentDeliveryUnitOfWork
{
	constructor(private readonly prisma: PrismaClient, private readonly logger: Logger = ___CreateLogger("agent-thread-parent-delivery")) {}

	async deliver(identity: AgentThreadRuntimeIdentity, command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>
	{
		const unit = this;
		return ___DoWithTrace("conversation.agent_thread.parent_delivery", { conversationId: command.childConversationId, runId: command.runId }, async function _TraceDelivery()
		{
			if (!_valid(command)) return { outcome: "denied", reason: "invalid_display_content" };
			try
			{
				return await unit.prisma.$transaction(async function _Deliver(transaction): Promise<DeliverAgentThreadParentResult>
				{
					return new PrismaAgentThreadParentDeliveryRepository(transaction).deliver(identity, command);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (err)
			{
				unit.logger.error({ err, conversationId: command.childConversationId, runId: command.runId, namespace: identity.namespace, serviceAccountName: identity.serviceAccountName, podUid: identity.podUid }, "Agent-thread parent delivery persistence failed");
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
