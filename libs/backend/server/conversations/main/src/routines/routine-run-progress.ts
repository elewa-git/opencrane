import { isDeepStrictEqual } from "node:util";

import { RoutineRunProgressCancellationDecisions, type RoutineRunProgressFacts, type RoutineRunProgressFactsRepository } from "@opencrane/backend/agents/execution/runs";
import { ___ParseRoutineRunProgressObservation, type RoutineRunProgressObservation } from "@opencrane/backend/server/agents/scheduling/contract";
import { AgentRunStates, AgentRunTerminalReasons, RoutineFiringDisposition } from "@opencrane/models/agents";
import { ConversationAuthorKinds, ConversationEntryKinds, MessageStates } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerStopDecisions, type ConversationComputerStopAdmission, type ConversationComputerStopPublishOutcome } from "../computers/interruptions/conversation-computer-stop.types";
import { ConversationComputerToolResultOutcomes } from "../computers/turns/conversation-computer-continuation.types";
import { ConversationComputerTurnProtocolStates } from "../computers/turns/conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnStore, FrozenConversationComputerTurn } from "../computers/turns/conversation-computer-turn.types";
import type { ConversationHistoryReader } from "@opencrane/backend/server/conversations/history";
import { _RoutineInstructionEntry } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistory } from "./routine-occurrence-history";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";
import { RoutineRunProgressWaitKinds, type RoutineRunProgressObserver, type RoutineRunProgressReporter, type RoutineRunProgressReporterDependencies, type RoutineRunProgressTurn, type RoutineRunProgressWait, type RoutineRunProgressWaitEvidenceDependencies, type RoutineRunProgressWaitEvidenceReader } from "./routine-run-progress.types";

type _TargetAdmission = Extract<ConversationComputerStopAdmission, { readonly target: unknown }>;

/** Checks current run facts and saved conversation evidence before selecting progress. */
export class ConversationRoutineRunProgressObserver implements RoutineRunProgressObserver
{
	/** Stores the run, turn, history and wait-evidence readers. */
	public constructor(private readonly facts: RoutineRunProgressFactsRepository, private readonly turns: Pick<ConversationComputerTurnStore, "load">, private readonly occurrences: Pick<RoutineOccurrenceHistory, "readRecord">, private readonly histories: Pick<ConversationHistoryReader, "read">, private readonly waits: RoutineRunProgressWaitEvidenceReader) {}

	/** Observes initial or resumed Running only when the checked run has no external wait. */
	public observeRunning(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>
	{
		return this._ObserveTurn(turn, async (saved, facts) =>
		{
			if (facts.state !== AgentRunStates.Running || await this.waits.read(saved) !== null)
				throw new Error("Routine running progress requires every external wait to be cleared");
			return _Observation(facts, RoutineFiringDisposition.Running, null, null);
		});
	}

	/** Observe Waiting only while the immutable turn still proves a tool-owned wait. */
	public observeWaiting(turn: RoutineRunProgressTurn, wait: RoutineRunProgressWait): Promise<RoutineRunProgressObservation | null>
	{
		return this._ObserveTurn(turn, async (saved, facts) =>
		{
			if (facts.state !== AgentRunStates.Running || !isDeepStrictEqual(await this.waits.read(saved), wait))
				throw new Error("Routine waiting progress requires its exact saved external wait");
			return _Observation(facts, RoutineFiringDisposition.Waiting, null, null);
		});
	}

	/** Observe uncertainty only from the saved unavailable receipt and RecoveryRequired run. */
	public observeUnavailable(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>
	{
		return this._ObserveTurn(turn, function _Unavailable(saved, facts)
		{
			const unavailable = saved.protocol.unavailable;
			if (facts.state !== AgentRunStates.RecoveryRequired || saved.protocol.state !== ConversationComputerTurnProtocolStates.ResponseUnavailable || unavailable === null)
				throw new Error("Routine uncertain progress requires its unavailable receipt and recovery run");
			return _Observation(facts, RoutineFiringDisposition.Uncertain, _TurnReference(saved.bootstrapId), ___DigestCanonicalJson(unavailable as unknown as JsonValue));
		});
	}

	/** Observe success only from the exact saved answer committed to conversation history. */
	public observeCompleted(turn: RoutineRunProgressTurn): Promise<RoutineRunProgressObservation | null>
	{
		return this._ObserveTurn(turn, async function _Completed(saved, facts, record, history)
		{
			return _CompletedObservation(saved, facts, record, history);
		});
	}

	/** Observe the exact output or cancellation winner only after SQL and Kurrent agree. */
	public async observeStop(admission: _TargetAdmission, outcome: ConversationComputerStopPublishOutcome): Promise<RoutineRunProgressObservation | null>
	{
		const turn = await this._LoadStopTurn(admission);
		const context = await this._Context(turn);
		if (context === null)
			return null;
		const { facts } = context;
		const cancellation = facts.cancellation;
		if (cancellation === null || cancellation.commandId !== admission.command.commandId || cancellation.commandDigest !== admission.commandDigest || cancellation.bootstrapId !== admission.target.bootstrapId)
			throw new Error("Routine Stop progress requires its exact saved cancellation admission");
		if (outcome.decision === ConversationComputerStopDecisions.OutputWon)
		{
			const output = turn.protocol.output;
			if (cancellation.decision !== RoutineRunProgressCancellationDecisions.OutputWon || output === null || outcome.outputReceiptDigest !== ___DigestCanonicalJson(output.receipt as unknown as JsonValue))
				throw new Error("Routine Stop output progress requires its completed output winner");
			return _CompletedObservation(turn, facts, context.record, context.history);
		}
		if (outcome.decision !== ConversationComputerStopDecisions.CancellationWon || cancellation.decision !== RoutineRunProgressCancellationDecisions.CancellationWon || facts.state !== AgentRunStates.Cancelled || facts.terminalReason !== AgentRunTerminalReasons.UserCancelled || turn.protocol.cancellation === null
			|| turn.protocol.cancellation.commandId !== admission.command.commandId || turn.protocol.cancellation.commandDigest !== admission.commandDigest)
			throw new Error("Routine Stop cancellation progress requires its finalized cancellation winner");
		return _Observation(facts, RoutineFiringDisposition.Cancelled, _TurnReference(turn.bootstrapId), ___DigestCanonicalJson(turn.protocol.cancellation as unknown as JsonValue));
	}

	/** Load the exact turn before using any caller-provided coordinate as evidence. */
	private async _LoadTurn(expected: RoutineRunProgressTurn): Promise<FrozenConversationComputerTurn>
	{
		const turn = await this.turns.load(expected.bootstrapId);
		if (turn === null || turn.siloId !== expected.siloId || turn.computerId !== expected.computerId || turn.lease.leaseId !== expected.lease.leaseId || turn.lease.leaseGeneration !== expected.lease.leaseGeneration
			|| turn.compile.runId !== expected.compile.runId || turn.compile.attempt !== expected.compile.attempt || turn.compile.digest !== expected.compile.digest
			|| turn.binding.conversationId !== expected.binding.conversationId || turn.latestPendingEntryId !== expected.latestPendingEntryId)
			throw new Error("Routine progress turn coordinates differ from saved history");
		return turn;
	}

	/** Reload the target fixed by Stop without inventing coordinates that its admission does not carry. */
	private async _LoadStopTurn(admission: _TargetAdmission): Promise<FrozenConversationComputerTurn>
	{
		const turn = await this.turns.load(admission.target.bootstrapId);
		if (turn === null || turn.bootstrapId !== admission.target.bootstrapId || turn.siloId !== admission.command.siloId || turn.computerId !== admission.command.computerId
			|| turn.binding.conversationId !== admission.command.conversationId || turn.lease.leaseId !== admission.target.leaseId || turn.lease.leaseGeneration !== admission.target.leaseGeneration
			|| turn.compile.runId !== admission.target.runId || turn.compile.attempt !== admission.target.attempt)
			throw new Error("Routine Stop progress differs from its saved turn");
		return turn;
	}

	/** Join run facts to the immutable occurrence record and complete conversation history. */
	private async _Context(turn: FrozenConversationComputerTurn): Promise<{ readonly facts: RoutineRunProgressFacts; readonly record: RoutineOccurrenceHistoryRecord; readonly history: Awaited<ReturnType<ConversationHistoryReader["read"]>> } | null>
	{
		const facts = await this.facts.read(turn.compile.runId, turn.compile.attempt);
		if (facts === null)
			return null;
		if (facts.siloId !== turn.siloId || facts.conversationId !== turn.binding.conversationId || facts.executionSubject.computerScope.computerId !== turn.computerId || facts.executionSubject.computerScope.leaseId !== turn.lease.leaseId || facts.executionSubject.computerScope.leaseGeneration !== turn.lease.leaseGeneration)
			throw new Error("Routine progress run differs from its frozen turn");
		const record = await this.occurrences.readRecord(turn.siloId, turn.binding.conversationId);
		if (record === null || record.origin.firingId !== facts.routine.firingId || record.origin.routineId !== facts.routine.routineId || record.origin.routineRevision !== facts.routine.routineRevision
			|| record.agentServiceId !== facts.agentServiceId || record.agentIdentityId !== facts.agentIdentityId || record.requesterPrincipalId !== facts.executionSubject.requester.requesterPrincipalId
			|| record.requesterAuthenticatedAt !== facts.executionSubject.requester.authenticatedAt || record.computerId !== turn.computerId)
			throw new Error("Routine progress run differs from its occurrence history");
		const history = await this.histories.read({ siloId: turn.siloId, conversationId: turn.binding.conversationId });
		if (!isDeepStrictEqual(history.entries[0], _RoutineInstructionEntry(record)))
			throw new Error("Routine progress requires its exact saved instruction");
		return { facts, record, history };
	}

	/** Apply one milestone mapping only after its shared evidence context is complete. */
	private async _ObserveTurn(turn: RoutineRunProgressTurn, observe: (saved: FrozenConversationComputerTurn, facts: RoutineRunProgressFacts, record: RoutineOccurrenceHistoryRecord, history: Awaited<ReturnType<ConversationHistoryReader["read"]>>) => RoutineRunProgressObservation | Promise<RoutineRunProgressObservation>): Promise<RoutineRunProgressObservation | null>
	{
		const saved = await this._LoadTurn(turn);
		const context = await this._Context(saved);
		return context === null ? null : observe(saved, context.facts, context.record, context.history);
	}
}

/** Rechecks the selected tool and current workload before classifying an external protocol wait. */
export class ConversationRoutineRunProgressWaitEvidenceReader implements RoutineRunProgressWaitEvidenceReader
{
	public constructor(private readonly dependencies: RoutineRunProgressWaitEvidenceDependencies) {}

	public async read(turn: FrozenConversationComputerTurn): Promise<RoutineRunProgressWait | null>
	{
		const step = turn.protocol.steps.at(-1);
		if (turn.protocol.state !== ConversationComputerTurnProtocolStates.ToolPending || step?.state !== ConversationComputerTurnProtocolStates.ToolPending)
			return null;
		const execution = await this.dependencies.candidates.assertCurrentForWorkflow(turn);
		const result = await this.dependencies.toolResults.read(turn, execution.workload);
		if (result.outcome === ConversationComputerToolResultOutcomes.Pending && result.waitFor === "approval")
			return { kind: RoutineRunProgressWaitKinds.Approval, id: step.selection.toolInvocationId };
		if (result.outcome === ConversationComputerToolResultOutcomes.GeneratedFilePending)
			return { kind: RoutineRunProgressWaitKinds.GeneratedFile, id: result.operationId };
		return null;
	}
}

/** Awaits scheduling acknowledgement before a producer can settle or return its milestone. */
export class ConversationRoutineRunProgressReporter implements RoutineRunProgressReporter
{
	public constructor(private readonly dependencies: RoutineRunProgressReporterDependencies) {}

	/** Record the checked Running milestone, including the initial Running no-op report. */
	public recordRunning(turn: RoutineRunProgressTurn): Promise<void> { return this._Record(this.dependencies.observer.observeRunning(turn)); }
	public recordWaiting(turn: RoutineRunProgressTurn, wait: RoutineRunProgressWait): Promise<void> { return this._Record(this.dependencies.observer.observeWaiting(turn, wait)); }
	public recordUnavailable(turn: RoutineRunProgressTurn): Promise<void> { return this._Record(this.dependencies.observer.observeUnavailable(turn)); }
	public recordCompleted(turn: RoutineRunProgressTurn): Promise<void> { return this._Record(this.dependencies.observer.observeCompleted(turn)); }
	public recordStop(admission: _TargetAdmission, outcome: ConversationComputerStopPublishOutcome): Promise<void> { return this._Record(this.dependencies.observer.observeStop(admission, outcome)); }

	private async _Record(observation: Promise<RoutineRunProgressObservation | null>): Promise<void>
	{
		const value = await observation;
		if (value !== null)
			await this.dependencies.sink.recordRunProgress(value);
	}
}

/** Copy exact run facts into the strict scheduling boundary. */
function _Observation(facts: RoutineRunProgressFacts, disposition: RoutineFiringDisposition, resultReference: string | null, resultDigest: `sha256:${string}` | null): RoutineRunProgressObservation
{
	return ___ParseRoutineRunProgressObservation({
		siloId: facts.siloId,
		routineId: facts.routine.routineId,
		routineRevision: facts.routine.routineRevision,
		firingId: facts.routine.firingId,
		runId: facts.runId,
		attempt: facts.attempt,
		inputSnapshotDigest: facts.inputSnapshotDigest,
		sourceState: facts.state,
		sourceFinishedAt: facts.finishedAt,
		sourceTerminalReason: facts.terminalReason,
		sourceCancellationCommandId: facts.cancellation?.commandId ?? null,
		sourceCancellationCommandDigest: facts.cancellation?.commandDigest ?? null,
		disposition,
		resultReference,
		resultDigest,
	});
}

/** Verify that a completed run names the exact assistant answer already saved in history. */
function _CompletedObservation(turn: FrozenConversationComputerTurn, facts: RoutineRunProgressFacts, record: RoutineOccurrenceHistoryRecord, history: Awaited<ReturnType<ConversationHistoryReader["read"]>>): RoutineRunProgressObservation
{
	const output = turn.protocol.output;
	if (facts.state !== AgentRunStates.Completed || facts.terminalReason !== AgentRunTerminalReasons.Success || facts.finishedAt === null || output === null)
		throw new Error("Routine completed progress requires its completed run and saved answer");
	const answer = output.receipt.event.data.entry;
	const matches = history.entries.filter(entry => entry.id === answer.id && isDeepStrictEqual(entry, answer));
	if (matches.length !== 1 || answer.kind !== ConversationEntryKinds.Message || answer.state !== MessageStates.Completed || answer.author.kind !== ConversationAuthorKinds.Agent
		|| answer.author.agentIdentityId !== facts.agentIdentityId || answer.author.agentServiceId !== facts.agentServiceId || answer.runId !== facts.runId
		|| answer.replyToEntryId !== _RoutineInstructionEntry(record).id || answer.replyToEntryId !== turn.latestPendingEntryId)
		throw new Error("Routine completed progress requires its exact saved assistant answer");
	return _Observation(facts, RoutineFiringDisposition.Completed, `${output.receipt.streamName}#${answer.id}`, ___DigestCanonicalJson(output.receipt as unknown as JsonValue));
}

/** Stable non-secret reference to the immutable turn stream. */
function _TurnReference(bootstrapId: string): string { return `conversation-computer-turn-${bootstrapId}`; }
