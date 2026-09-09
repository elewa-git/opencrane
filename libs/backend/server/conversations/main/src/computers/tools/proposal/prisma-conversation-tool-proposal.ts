import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationToolProposalOutcomes, type ConversationToolProposal, type ConversationToolProposalReceipt } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __PrepareToolInvocationInTransaction, ToolInvocationAdmissionOutcomes, ToolInvocationStates, type ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { _PrepareConversationToolProposal } from "./conversation-tool-proposal";
import { ConversationToolProposalRefusals, type ConversationToolProposalAdmission, type PreparedConversationToolProposal, type ConversationToolProposalRepository, type ConversationToolProposalRuntimeAdmission } from "./conversation-tool-proposal.types";
import { PrismaConversationToolDispatchAuthority } from "../dispatch/prisma-conversation-tool-dispatch-authority";
import { PrismaConversationToolProposalRunRepository } from "./prisma-conversation-tool-proposal-run-reader";
import { PrismaConversationToolProposalPreparationAuthority } from "./prisma-conversation-tool-proposal-preparation";

/**
 * Admits a proposal and its executor work in the same transaction.
 *
 * The reader checks the saved run and call slot; preparation records permission and the invocation.
 * A later refusal must throw, so neither those writes nor executor admission can commit alone.
 * The executor still claims the invocation and rechecks current permission before calling the tool.
 */
export class PrismaConversationToolProposalRepository implements ConversationToolProposalRepository
{
	/** Bind all invocation writes and permission decisions to this transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies, private readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission) {}

	/** Save the proposal or reuse the identical saved call, checking access before executor admission. */
	public async admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>
	{
		const reader = new PrismaConversationToolProposalRunRepository(this.transaction);
		const run = await reader.load(turn, candidate, proposal);
		const preparation = new PrismaConversationToolProposalPreparationAuthority(this.transaction);
		const result = await preparation.admit(turn, run, proposal, workload);
		// Recheck access after the tentative insert; a refusal must roll back that insert too.
		const authority = new PrismaConversationToolDispatchAuthority(this.transaction, this.dependencies);
		const admittedUntil = await authority.admitUntil(result.invocation, new Date(), workload);
		if (admittedUntil === null
			|| candidate.compiledInput.budget.wallClockDeadlineEpochMs! <= Date.now()
			|| Date.parse(candidate.credentialExpiresAt) <= Date.now())
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		if (result.invocation.state === ToolInvocationStates.Preparing)
			await __PrepareToolInvocationInTransaction(this.transaction, result.invocation.id, result.invocation.revision, new Date());
		const runtimeAdmitted = await this.runtimeAdmission(this.transaction, result.invocation.id);
		if (!runtimeAdmitted
			|| candidate.compiledInput.budget.wallClockDeadlineEpochMs! <= Date.now()
			|| Date.parse(candidate.credentialExpiresAt) <= Date.now())
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		return {
			proposalId: result.invocation.toolInvocationId,
			outcome: result.outcome === ToolInvocationAdmissionOutcomes.Admitted ? ConversationToolProposalOutcomes.Recorded : ConversationToolProposalOutcomes.Existing,
		};
	}
}

/** Opens a Serializable transaction after the caller has verified the proposing Pod. */
export class PrismaConversationToolProposalUnitOfWork implements ConversationToolProposalAdmission
{
	/** Supply current permission checks and an executor admission callback that shares the transaction. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ConversationToolDispatchDependencies, private readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission) {}

	/** Validate the proposal once; retry the complete transaction only when PostgreSQL proves it rolled back. */
	public admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: ConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>
	{
		const prepared = _PrepareConversationToolProposal(turn, candidate, proposal);
		const dependencies = this.dependencies;
		const prisma = this.prisma;
		const runtimeAdmission = this.runtimeAdmission;
		return ___DoWithTrace("conversation.tool_proposal.admit", {}, async function _ProposalAdmission()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Admit(transaction)
			{
				const repository = new PrismaConversationToolProposalRepository(transaction, dependencies, runtimeAdmission);
				return repository.admit(turn, candidate, prepared, workload);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "conversation tool proposal", attemptLimit: 3, timeout: 10_000 });
		});
	}
}
