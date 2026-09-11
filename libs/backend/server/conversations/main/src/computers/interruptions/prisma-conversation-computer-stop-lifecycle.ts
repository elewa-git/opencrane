import { Prisma, type PrismaClient } from "@prisma/client";
import { ConversationRunCancellationDecisions, PrismaConversationRunCancellationRepository, type ConversationRunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, type ConversationComputerStopAdmission, type ConversationComputerStopLifecycle, type ConversationComputerStopPublishOutcome } from "./conversation-computer-stop.types";
import { PrismaConversationComputerStopClockRepository } from "./prisma-conversation-computer-stop-clock";

type _TargetAdmission = Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>;

/** Applies the Kurrent winner and cancellation cleanup through transaction-bound run owners. */
export class PrismaConversationComputerStopLifecycleUnitOfWork implements ConversationComputerStopLifecycle
{
	/** Keeps every run and IAM operation behind its transaction-bound repository. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** Records only a terminal target winner returned by the history authority. */
	public recordDecision(admission: _TargetAdmission, outcome: ConversationComputerStopPublishOutcome): Promise<void>
	{
		if (outcome.decision !== ConversationComputerStopDecisions.CancellationWon && outcome.decision !== ConversationComputerStopDecisions.OutputWon)
			throw new Error("conversation Stop target requires a terminal history decision");
		if (outcome.decision === ConversationComputerStopDecisions.OutputWon && outcome.outputReceiptDigest === null)
			throw new Error("conversation Stop output winner requires its exact receipt digest");
		const decision = outcome.decision === ConversationComputerStopDecisions.CancellationWon ? ConversationRunCancellationDecisions.CancellationWon : ConversationRunCancellationDecisions.OutputWon;
		return this._Run(async function _Record(repository, now)
		{
			await repository.recordDecision({ commandId: admission.command.commandId, commandDigest: admission.commandDigest, decision, decidedAt: now });
		}, "record conversation Stop terminal decision");
	}

	/** Closes interaction, provider-free invocations and claims whose saved expiry has passed. */
	public cleanup(admission: _TargetAdmission): Promise<{ readonly activeClaimCount: number; readonly nextClaimExpiryAt: string | null }>
	{
		return this._Run(async function _Cleanup(repository, now)
		{
			const result = await repository.cleanup(admission.command.commandId, admission.commandDigest, now);
			return { activeClaimCount: result.activeClaimCount, nextClaimExpiryAt: result.nextClaimExpiryAt?.toISOString() ?? null };
		}, "clean up cancelled conversation work");
	}

	/** Finalizes only the saved cancellation winner after no provider claim remains. */
	public finalize(admission: _TargetAdmission): Promise<boolean>
	{
		return this._Run(function _Finalize(repository, now)
		{
			return repository.finalize(admission.command.commandId, admission.commandDigest, now);
		}, "finalize cancelled conversation work");
	}

	/** Supplies database time and one transaction-bound repository to an operation. */
	private _Run<Result>(operation: (repository: ConversationRunCancellationRepository, now: Date) => Promise<Result>, name: string): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
		{
			const clock = new PrismaConversationComputerStopClockRepository(transaction);
			const runs = new PrismaConversationRunCancellationRepository(transaction);
			return operation(runs, await clock.now());
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: name, attemptLimit: 3 });
	}
}
