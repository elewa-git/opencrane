import { Prisma, type PrismaClient } from "@prisma/client";
import { ConversationRunCancellationDenied, PrismaConversationRunCancellationRepository } from "@opencrane/backend/agents/execution/runs";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../turns/workflow/conversation-computer-turn-task";
import { ConversationComputerStopAdmissionKinds, type ConversationComputerStopActiveTurnReader, type ConversationComputerStopCommand, type ConversationComputerStopTargetReader, type ConversationComputerStopTargetRepository, type ConversationComputerStopTargetResolution } from "./conversation-computer-stop.types";
import { PrismaConversationComputerStopClockRepository } from "./prisma-conversation-computer-stop-clock";
import { PrismaConversationComputerStopRequesterRepository } from "./prisma-conversation-computer-stop-requester";
import { ConversationComputerStopDenied } from "./conversation-computer-stop-denied";

/** Reads an active lease on the transaction selected by the target unit of work. */
export class PrismaConversationComputerStopTargetRepository implements ConversationComputerStopTargetRepository
{
	/** Binds lease and clock reads to one transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly clock: PrismaConversationComputerStopClockRepository) {}

	/** Returns the current exact-generation lease, or null when no authoritative pointer can be named. */
	public async readLease(command: ConversationComputerStopCommand): Promise<{ readonly leaseId: string; readonly leaseGeneration: number } | null>
	{
		const now = await this.clock.now();
		return this.transaction.conversationComputerActiveLease.findFirst({ where: { siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, leaseGeneration: command.generation, expiresAt: { gt: now } }, select: { leaseId: true, leaseGeneration: true } });
	}
}

/** Resolves an exact relational lease before asking history for its active turn. */
export class PrismaConversationComputerStopTargetUnitOfWork implements ConversationComputerStopTargetReader
{
	/** Keeps lease selection separate from history-owned pointer decoding. */
	public constructor(private readonly prisma: PrismaClient, private readonly activeTurns: ConversationComputerStopActiveTurnReader) {}

	/** Refuses an absent or expired lease because no authoritative active stream can be derived. */
	public async resolve(command: ConversationComputerStopCommand): Promise<ConversationComputerStopTargetResolution | null>
	{
		const lease = await ___RunInPrismaUnitOfWork(this.prisma, async function _ResolveLease(transaction)
		{
			const clock = new PrismaConversationComputerStopClockRepository(transaction);
			const repository = new PrismaConversationComputerStopTargetRepository(transaction, clock);
			return repository.readLease(command);
		}, { isolationLevel: "ReadCommitted", operation: "resolve conversation Stop active lease" });
		if (lease === null)
			return null;
		const active = await this.activeTurns.read({ siloId: command.siloId, computerId: command.computerId, leaseId: lease.leaseId, leaseGeneration: lease.leaseGeneration });
		if (active.turn !== null && BigInt(active.turn.latestPendingEntryPosition) >= BigInt(command.causationPosition))
			return null;
		if (active.turn === null)
		{
			const commandDigest = ___DigestCanonicalJson({ command, activeTurnStreamName: active.activeTurnStreamName, activeTurnExpectedRevision: active.activeTurnExpectedRevision } as unknown as JsonValue);
			const authorizationDecisionDigest = await this._Authorize(command, commandDigest, lease.leaseId);
			return { kind: ConversationComputerStopAdmissionKinds.NoTarget, commandDigest, activeTurnStreamName: active.activeTurnStreamName, activeTurnExpectedRevision: active.activeTurnExpectedRevision, authorizationDecisionDigest };
		}
		const target = { bootstrapId: active.turn.bootstrapId, runId: active.turn.compile.runId, attempt: active.turn.compile.attempt, leaseId: active.turn.lease.leaseId, leaseGeneration: active.turn.lease.leaseGeneration };
		if (active.activeTurnExpectedRevision === null)
			throw new Error("conversation Stop active target omitted its pointer revision");
		let evidence;
		try
		{
			evidence = await ___RunInPrismaUnitOfWork(this.prisma, async function _AuthorizeTargetSelection(transaction)
			{
				const clock = new PrismaConversationComputerStopClockRepository(transaction);
				const requester = new PrismaConversationComputerStopRequesterRepository(transaction);
				const runs = new PrismaConversationRunCancellationRepository(transaction);
				const originalTurnTask = await runs.verifyTarget({ ...target, siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, requesterPrincipalId: command.requester.principalId, expectedOriginalTurnTaskName: CONVERSATION_COMPUTER_TURN_TASK.taskName });
				const commandDigest = ___DigestCanonicalJson({ command, target, originalTurnTask } as unknown as JsonValue);
				const authorizationDecisionDigest = await requester.authorize(command, commandDigest, lease.leaseId, await clock.now());
				return { commandDigest, authorizationDecisionDigest, originalTurnTask };
			}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, operation: "authorize conversation Stop target selection" });
		}
		catch (error)
		{
			if (error instanceof ConversationRunCancellationDenied)
				throw new ConversationComputerStopDenied(error.message);
			throw error;
		}
		return { kind: ConversationComputerStopAdmissionKinds.Target, command, target, activeTurnStreamName: active.activeTurnStreamName, activeTurnExpectedRevision: active.activeTurnExpectedRevision, ...evidence };
	}

	/** Records current authority before a no-target selection writes Kurrent history. */
	private _Authorize(command: ConversationComputerStopCommand, commandDigest: `sha256:${string}`, leaseId: string): Promise<string>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _AuthorizeSelection(transaction)
		{
			const clock = new PrismaConversationComputerStopClockRepository(transaction);
			const requester = new PrismaConversationComputerStopRequesterRepository(transaction);
			return requester.authorize(command, commandDigest, leaseId, await clock.now());
		}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, operation: "authorize conversation Stop without target" });
	}
}
