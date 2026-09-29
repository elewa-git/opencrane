import { isDeepStrictEqual } from "node:util";

import { Prisma, type PrismaClient } from "@prisma/client";

import { __CompileRunInput, __RevalidateRunInputSnapshot, __RunInputAuthorityExpiresAt, SessionAssemblyLoadOutcomes, TransactionBoundProductResourceAuthorizationSource } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRoutineRunSnapshotRecoveryRepository } from "@opencrane/backend/agents/execution/runs";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ConversationAuthorKinds, ConversationEntryKinds, MessageStates, type ConversationEntry } from "@opencrane/contracts";
import { ConversationComputerHistory, _ComputerScopeOf, _LeaseScopeOf } from "@opencrane/backend/server/conversations/computers";
import { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerTurnCandidate, ConversationComputerTurnCompileCommand, ConversationComputerTurnHistoryAnchor } from "../computers/turns/conversation-computer-turn.types";
import { CONVERSATION_COMPUTER_TURN_TASK } from "../computers/turns/workflow/conversation-computer-turn-task";
import { PrismaConversationComputerTurnWorkflowReceiptRepository } from "../computers/turns/workflow/prisma-conversation-computer-turn-workflow-receipt-repository";
import { _AssertRoutineActivationComputer, _RoutineActivationCommand, _RoutineActivationEnded, _RoutineActivationReceipt, _RoutineOccurrenceCommand } from "./routine-computer-activation.mapper";
import { _RoutineEventId, _RoutineInstructionEntry, _RoutinePreparationReceipt } from "./routine-occurrence-history.mapper";
import { _RoutineRunCommand } from "./routine-run-coordinates";
import { _RoutineExecutionSubject, _RoutinePromptCompiler } from "./routine-run-input-composition";
import { RoutineTurnDispatchKinds, type RoutineTurnCompilerDependencies, type RoutineTurnDispatcher, type RoutineTurnDispatchResult } from "./routine-turn-compiler.types";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/**
 * Recovers a routine turn without any run-admission or workflow-spawn dependency. Recovery still
 * rechecks current authority and may record its audit evidence inside the caller's transaction.
 */
export class PrismaRoutineTurnCompilerRepository implements RoutineTurnDispatcher
{
	/** Shares one database view between snapshot recovery, receipts and current authorization. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: RoutineTurnCompilerDependencies) {}

	/** Verifies first-turn history before a later human request can use interactive admission. */
	public async dispatch(command: ConversationComputerTurnCompileCommand, anchor?: ConversationComputerTurnHistoryAnchor): Promise<RoutineTurnDispatchResult>
	{
		const record = await this.dependencies.occurrences.readRecord(command.computer.siloId, command.computer.conversationId);
		if (record === null)
			throw new Error("Routine dispatch requires its attested instruction record");
		if (record.computerId !== command.computer.computerId || record.agentIdentityId !== command.computer.agentIdentityId)
			throw new Error("Routine dispatch received another logical computer");
		const histories = new ConversationHistoryReader(this.dependencies.history);
		const history = await histories.read({ siloId: record.siloId, conversationId: record.conversationId });
		const instruction = _RoutineInstructionEntry(record);
		if (!isDeepStrictEqual(history.entries[0], instruction) || history.entries.filter(entry => entry.id === instruction.id).length !== 1)
			throw new Error("Routine dispatch instruction differs from its attested history");
		const prefix = anchor === undefined ? history.entries : history.entries.filter(entry => BigInt(entry.position) <= anchor.expectedRevision);
		const answered = _RoutineInstructionAnswered(prefix, record);
		if (anchor !== undefined && anchor.latestPendingEntryId !== instruction.id)
		{
			const pending = prefix.find(entry => entry.id === anchor.latestPendingEntryId);
			if (!answered || pending?.kind !== ConversationEntryKinds.Message || pending.author.kind !== ConversationAuthorKinds.Human || BigInt(prefix.at(-1)?.position ?? "0") !== anchor.expectedRevision)
				throw new Error("Routine follow-up anchor has no completed initial instruction");
			return { kind: RoutineTurnDispatchKinds.Interactive };
		}
		if (anchor === undefined && answered)
			return { kind: RoutineTurnDispatchKinds.Interactive };
		const candidate = await this.compile(command, anchor);
		return candidate === null ? { kind: RoutineTurnDispatchKinds.Routine } : { kind: RoutineTurnDispatchKinds.Routine, candidate };
	}

	/** Requires the attested first instruction and its previously admitted run to agree at every boundary. */
	public async compile(command: ConversationComputerTurnCompileCommand, anchor?: ConversationComputerTurnHistoryAnchor): Promise<ConversationComputerTurnCandidate | null>
	{
		const dependencies = this.dependencies;
		const record = await dependencies.occurrences.readRecord(command.computer.siloId, command.computer.conversationId);
		if (record === null)
			return null;
		const computers = new ConversationComputerHistory(dependencies.history);
		const current = await computers.load({ computer: command.computer, profileRevisionId: command.profileRevisionId });
		_AssertRoutineActivationComputer(current);
		if (_RoutineActivationEnded(current, Date.now()) || current.lease === null)
			return null;
		const expectedComputer = { siloId: record.siloId, conversationId: record.conversationId, computerId: record.computerId, agentIdentityId: record.agentIdentityId };
		if (!isDeepStrictEqual(command.computer, expectedComputer) || command.profileRevisionId !== record.profileRevisionId || !isDeepStrictEqual(command.lease, { ..._LeaseScopeOf(current.lease), sandboxClaimId: current.lease.sandboxClaimId }))
			throw new Error("Routine turn compiler received another computer or lease");
		const preparation = _RoutinePreparationReceipt(record);
		const publication = { computer: _ComputerScopeOf(current.computer), lease: { ..._LeaseScopeOf(current.lease), expiresAt: current.lease.expiresAt } };
		const activation = _RoutineActivationReceipt(record, preparation, current, publication);
		const admission = _RoutineRunCommand(record);
		const runs = new PrismaRoutineRunSnapshotRecoveryRepository(this.transaction);
		const snapshot = await runs.recover(admission, 1);
		if (snapshot === null)
			return null;
		const routines = dependencies.routines(this.transaction);
		if (!await routines.recover({ ..._RoutineOccurrenceCommand(record), preparation, activation }, snapshot.runId))
			throw new Error("Routine compilation has no matching saved stage receipts");
		const receipts = new PrismaConversationComputerTurnWorkflowReceiptRepository(this.transaction);
		const receipt = await receipts.read(snapshot.runId, 1);
		if (receipt === null || receipt.taskName !== CONVERSATION_COMPUTER_TURN_TASK.taskName || receipt.idempotencyKey !== _RoutineActivationCommand(record).activationEventId)
			throw new Error("Routine compilation has no matching admitted turn task");
		const histories = new ConversationHistoryReader(dependencies.history);
		const history = await histories.read({ siloId: record.siloId, conversationId: record.conversationId });
		const pendingId = _RoutineEventId("instruction", record.conversationId);
		const outputRevision = BigInt(history.entries.at(-1)?.position ?? "0");
		const expectedRevision = anchor?.expectedRevision ?? outputRevision;
		const entries = history.entries.filter(entry => BigInt(entry.position) <= expectedRevision);
		if (BigInt(entries.at(-1)?.position ?? "-1") !== expectedRevision || !isDeepStrictEqual(entries[0], _RoutineInstructionEntry(record)) || anchor !== undefined && anchor.latestPendingEntryId !== pendingId)
			throw new Error("Routine compilation history anchor differs from its admitted instruction");
		if (_RoutineInstructionAnswered(entries, record))
			return null;
		const now = new Date();
		const context = { prisma: this.transaction, authorization: new PrismaAuthorizationAuthority(this.transaction), admittedAt: now.toISOString(), admittedAtEpochMs: now.getTime() };
		const authorities = { executionSubject: _RoutineExecutionSubject(dependencies, record, admission, current), productAuthorization: new TransactionBoundProductResourceAuthorizationSource() };
		const subject = await __RevalidateRunInputSnapshot(admission, snapshot, authorities, context);
		if (subject.outcome === SessionAssemblyLoadOutcomes.Denied)
			throw new Error("Routine compilation no longer has current execution authority");
		const compiler = _RoutinePromptCompiler(this.transaction, dependencies, admission);
		const compiledInput = await __CompileRunInput(snapshot, snapshot.attempt, compiler);
		const expiresAt = __RunInputAuthorityExpiresAt(snapshot, compiledInput, subject.value);
		const remaining = Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000);
		if (!Number.isFinite(remaining) || remaining < 1)
			throw new Error("Routine compilation requires unexpired execution authority");
		const service = await this.transaction.agentService.findUnique({ where: { id: record.agentServiceId }, select: { name: true } });
		if (service === null)
			throw new Error("Routine compilation lost its managed service");
		return { binding: { ...command.computer, agentServiceId: record.agentServiceId, agentName: service.name, agentAvatarArtifactRevisionId: null, runId: snapshot.runId, leaseGeneration: command.lease.leaseGeneration, expectedRevision: outputRevision, maximumEntryBytes: 65_536 }, compiledInput, latestPendingEntryId: pendingId, latestPendingEntryPosition: "1", modelAlias: compiledInput.model.modelAlias, maximumBudgetUsd: dependencies.maximumTurnCostUsdMicros / 1_000_000, credentialLifetimeSeconds: Math.min(300, remaining), credentialExpiresAt: expiresAt, lease: command.lease };
	}
}

/** Only the selected managed agent's admitted initial run can finish the service instruction. */
function _RoutineInstructionAnswered(entries: readonly ConversationEntry[], record: RoutineOccurrenceHistoryRecord): boolean
{
	const runId = _RoutineRunCommand(record).runId;
	const instructionId = _RoutineEventId("instruction", record.conversationId);
	return entries.some(entry => entry.kind === ConversationEntryKinds.Message && entry.state === MessageStates.Completed && entry.author.kind === ConversationAuthorKinds.Agent && entry.author.agentIdentityId === record.agentIdentityId && entry.author.agentServiceId === record.agentServiceId && entry.runId === runId && entry.replyToEntryId === instructionId);
}

/** Opens the same authority transaction for initial compilation and frozen-turn revalidation. */
export class PrismaRoutineTurnCompilerUnitOfWork implements RoutineTurnDispatcher
{
	/** Receives no admission or spawn port: recovery cannot create a second execution. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: RoutineTurnCompilerDependencies) {}

	/** Rebuilds input only from the saved run and its checked occurrence history. */
	public dispatch(command: ConversationComputerTurnCompileCommand, anchor?: ConversationComputerTurnHistoryAnchor): Promise<RoutineTurnDispatchResult>
	{
		const dependencies = this.dependencies;
		const prisma = this.prisma;
		return ___DoWithTrace("routine.turn_recover", { siloId: command.computer.siloId, conversationId: command.computer.conversationId, computerId: command.computer.computerId }, async function _Dispatch()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Recover(transaction)
			{
				const repository = new PrismaRoutineTurnCompilerRepository(transaction, dependencies);
				return repository.dispatch(command, anchor);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, operation: "routine turn recovery" });
		});
	}
}
