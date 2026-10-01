import { Prisma, type PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ConversationLogToolKinds } from "@opencrane/contracts";

import type { ConversationComputerTurnCandidateResolver, ConversationComputerTurnStore } from "../../turns/conversation-computer-turn.types";
import { ConversationComputerTurnProtocolStates } from "../../turns/conversation-computer-turn-protocol.types";
import type { ConversationToolProgressNotificationEvidence, ConversationToolRequestedNotificationCommand, ConversationToolRequestedNotificationEvidenceReader } from "../../turns/tool-progress-notifications/conversation-tool-progress-notification.types";
import type { ConversationToolRequestedNotificationRecord, ConversationToolRequestedNotificationRepository } from "./conversation-tool-progress-notification-persistence.types";

/** Rechecks the saved turn, current candidate and exact committed proposal without writing either store. */
export class CurrentConversationToolRequestedNotificationEvidenceReader implements ConversationToolRequestedNotificationEvidenceReader
{
	/** Transaction owner that keeps the public composition signature free of persistence details. */
	private readonly _unitOfWork: _CurrentConversationToolRequestedNotificationEvidenceUnitOfWork;

	/** Bind proposal persistence to the existing current-turn and lease authority. */
	public constructor(prisma: PrismaClient, turns: Pick<ConversationComputerTurnStore, "load">, candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrentForWorkflow">)
	{
		this._unitOfWork = new _CurrentConversationToolRequestedNotificationEvidenceUnitOfWork(prisma, turns, candidates);
	}

	/** Return the frozen display facts only while the admitted proposal still belongs to this turn. */
	public readCurrent(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>
	{
		return this._unitOfWork.readCurrent(command);
	}
}

/** Owns the bounded proposal transaction after current turn and candidate validation. */
class _CurrentConversationToolRequestedNotificationEvidenceUnitOfWork implements ConversationToolRequestedNotificationEvidenceReader
{
	/** Opens the bounded proposal-row read transaction. */
	private readonly _prisma: PrismaClient;
	/** Loads the saved workflow turn before SQL evidence is considered. */
	private readonly _turns: Pick<ConversationComputerTurnStore, "load">;
	/** Rechecks that the compiled candidate remains current for the saved turn. */
	private readonly _candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrentForWorkflow">;

	/** Bind one root Prisma client and the existing non-SQL current-turn authorities. */
	public constructor(prisma: PrismaClient, turns: Pick<ConversationComputerTurnStore, "load">, candidates: Pick<ConversationComputerTurnCandidateResolver, "assertCurrentForWorkflow">)
	{
		this._prisma = prisma;
		this._turns = turns;
		this._candidates = candidates;
	}

	/** Return the frozen display facts only while the admitted proposal still belongs to this turn. */
	public async readCurrent(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>
	{
		const turn = await this._turns.load(command.bootstrapId);
		const current = turn?.protocol.steps.at(-1);
		const selection = current?.state === ConversationComputerTurnProtocolStates.ToolPending ? current.selection : null;
		const reservation = current?.state === ConversationComputerTurnProtocolStates.ToolPending ? current.reservation : null;
		if (turn === null || turn.siloId !== command.siloId || turn.binding.conversationId !== command.conversationId
			|| turn.compile.runId !== command.runId || turn.compile.attempt !== command.attempt
			|| current?.state !== ConversationComputerTurnProtocolStates.ToolPending
			|| selection === null || reservation === null || selection.ordinal !== reservation.ordinal || selection.proposalId !== selection.toolInvocationId
			|| selection.toolInvocationId !== command.toolInvocationId || turn.protocol.output !== null || turn.protocol.unavailable !== null || turn.protocol.cancellation !== null)
			return null;
		const execution = await this._candidates.assertCurrentForWorkflow(turn);
		const candidate = execution.candidate;
		const input = candidate.compiledInput;
		if (input.runId !== turn.compile.runId || input.attempt !== turn.compile.attempt || input.digest !== turn.compile.digest
			|| input.promptCompilerVersion !== turn.compile.promptCompilerVersion)
			return null;
		const invocation = await ___RunInPrismaUnitOfWork(this._prisma, async function _Read(transaction)
		{
			const repository = new _PrismaConversationToolRequestedNotificationRepository(transaction);
			return repository.readExact(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, operation: "conversation tool requested evidence", attemptLimit: 1, timeout: 5_000 });
		if (invocation === null || invocation.siloId !== command.siloId || invocation.runId !== command.runId || invocation.attempt !== command.attempt
			|| invocation.mcpTaskId !== null || invocation.runtimeInstanceId !== turn.computerId || invocation.commandId !== turn.bootstrapId
			|| invocation.candidateId !== command.toolInvocationId || invocation.toolInvocationId !== command.toolInvocationId
			|| invocation.requestFingerprint !== selection.requestFingerprint)
			return null;
		const tools = input.tools.filter(tool => tool.toolRevisionId === invocation.toolRevisionId);
		if (tools.length !== 1)
			return null;
		const tool = tools[0]!;
		return { ...command, toolName: tool.name, toolKind: ConversationLogToolKinds.Mcp, occurredAt: invocation.createdAt.toISOString() };
	}
}

/** Reads only the immutable proposal row needed by current requested evidence. */
class _PrismaConversationToolRequestedNotificationRepository implements ConversationToolRequestedNotificationRepository
{
	/** Exact transaction that owns the proposal delegate read. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind proposal reads to the exact transaction supplied by the evidence unit of work. */
	public constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Read one proposal by its unique run, attempt and public invocation coordinates. */
	public readExact(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolRequestedNotificationRecord | null>
	{
		return this._transaction.toolInvocation.findUnique({
			where: { runId_attempt_toolInvocationId: { runId: command.runId, attempt: command.attempt, toolInvocationId: command.toolInvocationId } },
			select: { siloId: true, runId: true, attempt: true, mcpTaskId: true, runtimeInstanceId: true, commandId: true, candidateId: true, toolRevisionId: true, toolInvocationId: true, requestFingerprint: true, createdAt: true },
		});
	}
}
