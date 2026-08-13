import { Prisma, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";
import { ___CreateLogger, ___DoWithTrace } from "@opencrane/backend/observability";

import type { AgentThreadParentDeliveryCommand, AgentThreadParentDeliveryUnitOfWork, AgentThreadRuntimeIdentity, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types.js";
import { PrismaAgentThreadParentDeliveryRepository } from "./prisma-agent-thread-parent-delivery-repository.js";

/**
 * Opens the serializable transaction for a runtime-authored Agent-thread parent delivery.
 *
 * The private runtime router has already reviewed the workload token before calling this class.
 * This owner validates the display payload, traces the operation, and maps database failures to a
 * stable denial while the transaction-bound repository resolves assignment and thread authority.
 * Keeping those reads and the insert in one transaction prevents an authority change from leaving
 * a parent delivery committed against facts read from another snapshot.
 *
 * Called by: `__CreateAgentThreadParentDeliveryRouter`; production constructs it in
 * `apps/opencrane/src/app/runtime-composition.ts`.
 *
 * @implements AgentThreadParentDeliveryUnitOfWork
 */
export class PrismaAgentThreadParentDeliveryUnitOfWork implements AgentThreadParentDeliveryUnitOfWork
{
	constructor(private readonly prisma: PrismaClient, private readonly logger: Logger = ___CreateLogger("agent-thread-parent-delivery")) {}

	/**
	 * Validates and persists one delivery without exposing database failures to the runtime.
	 *
	 * Called by: the POST handler returned by `__CreateAgentThreadParentDeliveryRouter`.
	 *
	 * @param identity - Workload coordinates derived from the reviewed runtime token.
	 * @param command - The requested immediate-parent delivery and its idempotency key.
	 * @returns The committed delivery, its identical replay, or a stable denial reason.
	 */
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

/** Rejects oversized display text and prevents non-asset deliveries from carrying an asset ID. */
function _valid(command: AgentThreadParentDeliveryCommand): boolean
{
	return command.idempotencyKey.trim().length > 0 && command.idempotencyKey.length <= 128
		&& command.label.trim().length > 0 && command.label.length <= 160
		&& command.detail.trim().length > 0 && command.detail.length <= 4000
		&& (command.kind === AgentThreadDeliveryKinds.Asset ? command.assetId !== null : command.assetId === null);
}
