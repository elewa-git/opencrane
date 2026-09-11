import { Prisma, type PrismaClient } from "@prisma/client";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { ConversationRunCancellationDenied, PrismaConversationRunCancellationRepository, type ConversationRunCancellationAdmission } from "@opencrane/backend/agents/execution/runs";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../turns/workflow/conversation-computer-turn-task";
import { ConversationComputerStopAdmissionKinds, type ConversationComputerStopAdmission, type ConversationComputerStopAdmissionAuthority, type ConversationComputerStopCommand, type ConversationComputerStopSelection } from "./conversation-computer-stop.types";
import { ConversationComputerStopDenied } from "./conversation-computer-stop-denied";
import { CONVERSATION_COMPUTER_STOP_TASK } from "./conversation-computer-stop-task";
import { PrismaConversationComputerStopClockRepository } from "./prisma-conversation-computer-stop-clock";
import { PrismaConversationComputerStopRequesterRepository } from "./prisma-conversation-computer-stop-requester";

/** Admits Stop against the current requester, conversation, lease, run and workflow in one transaction. */
export class PrismaConversationComputerStopAdmissionUnitOfWork implements ConversationComputerStopAdmissionAuthority
{
	/** Connects product authority, run lifecycle and workflow admission to the same Prisma transaction. */
	public constructor(private readonly prisma: PrismaClient, private readonly workflows: Pick<IWorkflowEngine, "spawn">) {}

	/** Reads a saved target before any caller resolves the active-turn pointer. */
	public read(command: ConversationComputerStopCommand): Promise<ConversationComputerStopAdmission | null>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Read(transaction)
		{
			const runs = new PrismaConversationRunCancellationRepository(transaction);
			const saved = await runs.read(command.commandId);
			if (saved === null)
				return null;
			return _TargetAdmission(command, saved);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, operation: "read conversation Stop admission" });
	}

	/** Rechecks current authority, admits the cancellation task and stores its target atomically. */
	public async admit(command: ConversationComputerStopCommand, selection: Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>): Promise<ConversationComputerStopAdmission>
	{
		const workflows = this.workflows;
		try
		{
			return await ___RunInPrismaUnitOfWork(this.prisma, async function _Admit(transaction)
			{
				const runs = new PrismaConversationRunCancellationRepository(transaction);
				const clock = new PrismaConversationComputerStopClockRepository(transaction);
				const requester = new PrismaConversationComputerStopRequesterRepository(transaction);
				const now = await clock.now();
				_AssertSelection(command, selection);
				const existing = await runs.read(command.commandId);
				if (existing !== null)
					return _TargetAdmission(command, existing);
				const target = selection.target;
				const expectedOriginalTurnTaskName = CONVERSATION_COMPUTER_TURN_TASK.taskName;
				const originalTurnTask = await runs.verifyTarget({ ...target, siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, requesterPrincipalId: command.requester.principalId, expectedOriginalTurnTaskName });
				if (___DigestCanonicalJson(originalTurnTask as unknown as JsonValue) !== ___DigestCanonicalJson(selection.originalTurnTask as unknown as JsonValue))
					throw new ConversationComputerStopDenied("conversation Stop original task changed after target selection");
				const commandDigest = ___DigestCanonicalJson({ command, target, originalTurnTask } as unknown as JsonValue);
				if (commandDigest !== selection.commandDigest)
					throw new ConversationComputerStopDenied("conversation Stop target selection digest changed before admission");
				const authorizationDecisionDigest = await requester.authorize(command, commandDigest, target.leaseId, now);
				const taskInput = { command, target, commandDigest, originalTurnTask };
				const cancellationTask = await workflows.spawn({ client: transaction }, { taskName: CONVERSATION_COMPUTER_STOP_TASK.taskName, idempotencyKey: command.commandId, input: taskInput });
				const saved = await runs.admit({ ...target, siloId: command.siloId, conversationId: command.conversationId, computerId: command.computerId, commandId: command.commandId, commandDigest, requesterPrincipalId: command.requester.principalId, expectedOriginalTurnTaskName, authorizationDecisionDigest, requestedAt: now, originalTurnTask, cancellationTask });
				return _TargetAdmission(command, saved);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "admit conversation Stop", attemptLimit: 3 });
		}
		catch (error)
		{
			if (error instanceof ConversationRunCancellationDenied)
				throw new ConversationComputerStopDenied(error.message);
			throw error;
		}
	}
}

/** Ensures a fresh target preceded the Stop message and uses its checked generation. */
function _AssertSelection(command: ConversationComputerStopCommand, selection: Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>): void
{
	if (___DigestCanonicalJson(selection.command as unknown as JsonValue) !== ___DigestCanonicalJson(command as unknown as JsonValue) || selection.target.leaseGeneration !== command.generation)
		throw new ConversationComputerStopDenied("conversation Stop cannot use this target selection");
}

/** Joins a stored runs admission with the immutable message command. */
function _TargetAdmission(command: ConversationComputerStopCommand, saved: ConversationRunCancellationAdmission): ConversationComputerStopAdmission
{
	if (saved.commandId !== command.commandId || saved.siloId !== command.siloId || saved.conversationId !== command.conversationId || saved.computerId !== command.computerId || saved.requesterPrincipalId !== command.requester.principalId)
		throw new ConversationComputerStopDenied("conversation Stop replay differs from its stored admission");
	const target = { bootstrapId: saved.bootstrapId, runId: saved.runId, attempt: saved.attempt, leaseId: saved.leaseId, leaseGeneration: saved.leaseGeneration };
	const commandDigest = ___DigestCanonicalJson({ command, target, originalTurnTask: saved.originalTurnTask } as unknown as JsonValue);
	if (saved.commandDigest !== commandDigest)
		throw new ConversationComputerStopDenied("conversation Stop replay differs from its stored command");
	return { kind: ConversationComputerStopAdmissionKinds.Target, command, commandDigest, target, originalTurnTask: saved.originalTurnTask, cancellationTask: saved.cancellationTask, requestedAt: saved.requestedAt.toISOString(), authorizationDecisionDigest: saved.authorizationDecisionDigest };
}
