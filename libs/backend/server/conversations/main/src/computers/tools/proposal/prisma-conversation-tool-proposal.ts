import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationToolProposalOutcomes, type ConversationToolProposal, type ConversationToolProposalReceipt } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __OpenDeferredToolApprovalInTransaction, __PrepareToolInvocationInTransaction, ToolInvocationAdmissionOutcomes, ToolInvocationStates, type ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import type { ConversationToolDispatchDependencies } from "../dispatch/conversation-tool-dispatch.types";
import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { _PrepareConversationToolProposal } from "./conversation-tool-proposal";
import { ConversationToolProposalRefusals, type ConversationToolApprovalExpiry, type ConversationToolProposalAdmission, type PreparedConversationToolProposal, type ConversationToolProposalRepository, type ConversationToolProposalRuntimeAdmission } from "./conversation-tool-proposal.types";
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
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies, private readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission, private readonly approvalExpiry: ConversationToolApprovalExpiry) {}

	/** Save the proposal or reuse the identical saved call, checking access before executor admission. */
	public async admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>
	{
		const now = new Date();
		if (proposal.tool.requiresApproval && Math.min(candidate.compiledInput.budget.wallClockDeadlineEpochMs ?? Number.POSITIVE_INFINITY, Date.parse(candidate.credentialExpiresAt)) <= now.getTime())
			await this.approvalExpiry(this.transaction, { runId: turn.compile.runId, attempt: turn.compile.attempt, now });
		const reader = new PrismaConversationToolProposalRunRepository(this.transaction);
		const run = await reader.load(turn, candidate, proposal);
		if (proposal.tool.requiresApproval && run.subject.membership.kind === ExecutionSubjectMembershipKinds.Managed)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const preparation = new PrismaConversationToolProposalPreparationAuthority(this.transaction);
		const result = await preparation.admit(turn, run, proposal, workload);
		if (proposal.tool.requiresApproval && (result.invocation.state === ToolInvocationStates.Failed || result.invocation.state === ToolInvocationStates.Succeeded))
			return { proposalId: result.invocation.toolInvocationId, outcome: ConversationToolProposalOutcomes.Existing };
		// Recheck access after the tentative insert; a refusal must roll back that insert too.
		const authority = new PrismaConversationToolDispatchAuthority(this.transaction, this.dependencies);
		const admittedUntil = await authority.admitUntil(result.invocation, new Date(), workload);
		if (admittedUntil === null
			|| candidate.compiledInput.budget.wallClockDeadlineEpochMs! <= Date.now()
			|| Date.parse(candidate.credentialExpiresAt) <= Date.now())
				throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const invocation = result.invocation.state === ToolInvocationStates.Preparing
			? await __PrepareToolInvocationInTransaction(this.transaction, result.invocation.id, result.invocation.revision, new Date(Math.max(now.getTime(), result.invocation.nextPreparationAttemptAt.getTime())))
			: result.invocation;
		if (invocation === null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		if (proposal.tool.requiresApproval)
		{
			if (invocation.state === ToolInvocationStates.Ready)
			{
				const runtimeAdmitted = await this.runtimeAdmission(this.transaction, invocation.id);
				if (!runtimeAdmitted
					|| candidate.compiledInput.budget.wallClockDeadlineEpochMs! <= Date.now()
					|| Date.parse(candidate.credentialExpiresAt) <= Date.now())
					throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
				return { proposalId: invocation.toolInvocationId, outcome: ConversationToolProposalOutcomes.Existing };
			}
			if (invocation.state === ToolInvocationStates.Failed)
				return { proposalId: invocation.toolInvocationId, outcome: ConversationToolProposalOutcomes.Existing };
			if (invocation.state !== ToolInvocationStates.AwaitingApproval)
				throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
			const deadline = candidate.compiledInput.budget.wallClockDeadlineEpochMs;
			const expiresAtEpochMs = Math.min(deadline ?? Number.POSITIVE_INFINITY, Date.parse(candidate.credentialExpiresAt));
			if (!Number.isSafeInteger(expiresAtEpochMs) || expiresAtEpochMs <= now.getTime())
				throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
			const opened = await __OpenDeferredToolApprovalInTransaction(this.transaction, {
				interruptId: invocation.toolInvocationId,
				runId: turn.compile.runId,
				attempt: turn.compile.attempt,
				toolInvocationId: invocation.toolInvocationId,
				toolRevisionId: proposal.tool.toolRevisionId,
				arguments: proposal.arguments,
				argumentsDigest: proposal.argumentsDigest,
				parametersSchema: proposal.tool.parametersSchema,
				parametersSchemaDigest: proposal.tool.parametersSchemaDigest,
				capabilitySetDigest: run.subject.capability.capabilitySetDigest,
				invocationId: invocation.id,
				now,
				expiresAt: new Date(expiresAtEpochMs),
			});
			if (!opened)
				throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
			return {
				proposalId: result.invocation.toolInvocationId,
				outcome: result.outcome === ToolInvocationAdmissionOutcomes.Admitted ? ConversationToolProposalOutcomes.Recorded : ConversationToolProposalOutcomes.Existing,
			};
		}
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
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ConversationToolDispatchDependencies, private readonly runtimeAdmission: ConversationToolProposalRuntimeAdmission, private readonly approvalExpiry: ConversationToolApprovalExpiry) {}

	/** Validate the proposal once; retry the complete transaction only when PostgreSQL proves it rolled back. */
	public admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: ConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>
	{
		const prepared = _PrepareConversationToolProposal(turn, candidate, proposal);
		const dependencies = this.dependencies;
		const prisma = this.prisma;
		const runtimeAdmission = this.runtimeAdmission;
		const approvalExpiry = this.approvalExpiry;
		return ___DoWithTrace("conversation.tool_proposal.admit", {}, async function _ProposalAdmission()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Admit(transaction)
			{
				const repository = new PrismaConversationToolProposalRepository(transaction, dependencies, runtimeAdmission, approvalExpiry);
				return repository.admit(turn, candidate, prepared, workload);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "conversation tool proposal", attemptLimit: 3, timeout: 10_000 });
		});
	}
}
