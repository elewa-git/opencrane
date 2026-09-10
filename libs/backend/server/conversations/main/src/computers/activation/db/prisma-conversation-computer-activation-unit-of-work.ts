import type { Prisma, PrismaClient } from "@prisma/client";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import type { ConversationComputerActivationCommand, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository, ConversationComputerActiveLeaseProjectionCommand } from "../conversation-computer-activation.types";
import { CONVERSATION_COMPUTER_TURN_TASK } from "../../turns/workflow/conversation-computer-turn-task";
import type { ConversationComputerTurnTaskInput } from "../../turns/workflow/conversation-computer-turn-workflow.types";
import { PrismaConversationComputerActivationProjectionRepository } from "./prisma-conversation-computer-activation-repository";

/** Owns the transaction isolation used to resolve activation and publish its active lease. */
export class PrismaConversationComputerActivationUnitOfWork implements ConversationComputerActivationProjectionRepository
{
	/** Keeps transaction creation outside the projection repository. */
	public constructor(private readonly prisma: PrismaClient, private readonly workflows: Pick<IWorkflowEngine, "spawn">) {}

	/** Resolves immutable activation coordinates against the current committed projection. */
	public resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>
	{
		return this._transaction(repository => repository.resolve(command), "ReadCommitted", "conversation computer activation projection");
	}

	/** Publishes the admitted lease while competing changes remain serialised. */
	public publishActiveLease(command: ConversationComputerActiveLeaseProjectionCommand, activation: Pick<ConversationComputerActivationCommand, "activationEventId" | "causationId" | "causationPosition">): Promise<void>
	{
		const workflows = this.workflows;
		return this._transaction(async function _PublishAndAdmit(repository, transaction)
		{
			await repository.publishActiveLease(command);
			const input: ConversationComputerTurnTaskInput = { siloId: command.computer.siloId, computerId: command.computer.computerId, leaseId: command.lease.leaseId, leaseGeneration: command.lease.leaseGeneration, activationEventId: activation.activationEventId, causationId: activation.causationId, causationPosition: activation.causationPosition };
			await workflows.spawn({ client: transaction }, { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: activation.activationEventId, input });
		}, "Serializable", "conversation computer active lease and turn admission", 3);
	}

	/** Constructs the projection repository from the transaction selected for this operation. */
	private _transaction<Result>(work: (repository: PrismaConversationComputerActivationProjectionRepository, transaction: Prisma.TransactionClient) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel, operation: string, attemptLimit?: number): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
		{
			return work(new PrismaConversationComputerActivationProjectionRepository(transaction), transaction);
		}, { isolationLevel, operation, attemptLimit });
	}
}
