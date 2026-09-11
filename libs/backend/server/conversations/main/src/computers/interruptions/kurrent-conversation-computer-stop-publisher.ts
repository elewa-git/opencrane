import { createHash } from "node:crypto";

import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryEvent, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ConversationAuthorKinds, ConversationEntryKinds, ___ConversationEntrySchema, type RunLogEntry } from "@opencrane/contracts";
import { _ConversationHistoryEntryAppend } from "@opencrane/backend/server/conversations/history";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerActiveTurnStreamName } from "../lifecycle/conversation-computer-activity";
import { _CANCELLED_EVENT, KurrentConversationComputerTurnStore } from "../turns/conversation-computer-turn-store";
import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions, type ConversationComputerStopAdmission, type ConversationComputerStopCommand, type ConversationComputerStopPublishOutcome, type ConversationComputerStopPublisher, type ConversationComputerStopSelection, type ConversationComputerStopTargetResolution } from "./conversation-computer-stop.types";
import { _ConversationComputerStopReceiptSchema, _ConversationComputerStopSelectionSchema } from "./conversation-computer-stop.validator";

const _RECEIPT_EVENT = "opencrane.conversation-computer-stop-receipt.v1";
const _SELECTION_EVENT = "opencrane.conversation-computer-stop-selection.v1";
const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
const _MAX_TARGET_CONTENTION_RETRIES = 8;

/** Arbitrates Stop against final output and retains the complete immutable result across retries. */
export class KurrentConversationComputerStopPublisher implements ConversationComputerStopPublisher
{
	private readonly turns: KurrentConversationComputerTurnStore;

	/** Connects Stop arbitration to the one atomic Kurrent history authority. */
	public constructor(private readonly history: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">)
	{
		this.turns = new KurrentConversationComputerTurnStore(history);
	}

	/** Return the exact saved decision before any caller attempts to select a target again. */
	public async recover(command: ConversationComputerStopCommand): Promise<ConversationComputerStopPublishOutcome | null>
	{
		const receipt = await _Terminal(this.history, _ReceiptStream(command.commandId));
		if (receipt === null)
			return null;
		return _ReadReceipt(receipt, command);
	}

	/** Returns the exact revision-zero target selection before another delivery resolves history. */
	public async recoverSelection(command: ConversationComputerStopCommand): Promise<ConversationComputerStopSelection | null>
	{
		const event = await _First(this.history, _ReceiptStream(command.commandId));
		if (event === null)
			return null;
		return _ReadSelection(event, command);
	}

	/** Atomically fixes Target or NoTarget against the active-pointer head observed by the authorized reader. */
	public async select(command: ConversationComputerStopCommand, resolution: ConversationComputerStopTargetResolution): Promise<ConversationComputerStopSelection | null>
	{
		const selection: ConversationComputerStopSelection = resolution.kind === ConversationComputerStopAdmissionKinds.Target
			? resolution
			: { command, ...resolution };
		_AssertSelectionCommand(_ConversationComputerStopSelectionSchema.parse(selection), command);
		if (selection.kind === ConversationComputerStopAdmissionKinds.NoTarget)
		{
			await this._publishNoTarget(selection);
			return this.recoverSelection(command);
		}
		const event = _Selection(selection);
		const activeRevision = BigInt(selection.activeTurnExpectedRevision);
		try
		{
			await this.history.appendAtomic({ expectedHeads: [{ streamName: selection.activeTurnStreamName, revision: activeRevision }, { streamName: event.streamName, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: event.streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [event.event] }] });
			return selection;
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			return this.recoverSelection(command);
		}
	}

	/** Commit either the checked no-target receipt or the terminal turn winner. */
	public async publish(admission: ConversationComputerStopAdmission): Promise<ConversationComputerStopPublishOutcome>
	{
		if (admission.kind === ConversationComputerStopAdmissionKinds.Target)
		{
			const selection = await this.recoverSelection(admission.command);
			if (selection === null || selection.kind !== ConversationComputerStopAdmissionKinds.Target)
				throw new Error("Conversation Stop target admission omitted its command selection");
			_AssertSelectionAdmission(selection, admission);
		}
		const recovered = await this.recover(admission.command);
		if (recovered !== null)
		{
			_AssertReceiptAdmission(await _TerminalRequired(this.history, _ReceiptStream(admission.command.commandId)), admission);
			await this._assertRecoveredDecision(admission, recovered);
			return recovered;
		}
		return admission.kind === ConversationComputerStopAdmissionKinds.NoTarget ? this._publishNoTarget(admission) : this._publishTarget(admission);
	}

	private async _assertRecoveredDecision(admission: ConversationComputerStopAdmission, outcome: ConversationComputerStopPublishOutcome): Promise<void>
	{
		if (outcome.decision === ConversationComputerStopDecisions.NoTarget)
		{
			if (admission.kind !== ConversationComputerStopAdmissionKinds.NoTarget || outcome.outputReceiptDigest !== null)
				throw new Error("Conversation Stop no-target receipt differs from its admission");
			return;
		}
		if (admission.kind !== ConversationComputerStopAdmissionKinds.Target)
			throw new Error("Conversation Stop target receipt differs from its admission");
		const turn = await this.turns.load(admission.target.bootstrapId);
		_AssertTarget(admission, turn);
		if (outcome.decision === ConversationComputerStopDecisions.CancellationWon)
		{
			if (turn!.cancellationReceipt?.commandId !== admission.command.commandId || turn!.cancellationReceipt.commandDigest !== admission.commandDigest || outcome.outputReceiptDigest !== null)
				throw new Error("Conversation Stop receipt differs from its cancellation winner");
			return;
		}
		const digest = turn!.outputReceipt === null ? null : ___DigestCanonicalJson(turn!.outputReceipt as unknown as JsonValue);
		if (outcome.decision !== ConversationComputerStopDecisions.OutputWon || outcome.outputReceiptDigest !== digest)
			throw new Error("Conversation Stop receipt differs from its output winner");
	}

	private async _publishNoTarget(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.NoTarget }>): Promise<ConversationComputerStopPublishOutcome>
	{
		const outcome = _Outcome(ConversationComputerStopDecisions.NoTarget, true, null);
		const receipt = _Receipt(admission, outcome);
		const revision = admission.activeTurnExpectedRevision === null ? HistoryExpectedRevisions.NoStream : BigInt(admission.activeTurnExpectedRevision);
		try
		{
			await this.history.appendAtomic({ expectedHeads: [{ streamName: admission.activeTurnStreamName, revision }, { streamName: receipt.streamName, revision: HistoryExpectedRevisions.NoStream }], appends: [{ streamName: receipt.streamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [receipt.event] }] });
			return outcome;
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const recovered = await this.recover(admission.command);
			if (recovered !== null)
				return recovered;
			return _Outcome(ConversationComputerStopDecisions.Stale, false, null);
		}
	}

	private async _publishTarget(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, contentionCount = 0): Promise<ConversationComputerStopPublishOutcome>
	{
		const turn = await this.turns.load(admission.target.bootstrapId);
		_AssertTarget(admission, turn);
		if (turn!.outputReceipt !== null)
			return this._recordOutputWinner(admission, ___DigestCanonicalJson(turn!.outputReceipt as unknown as JsonValue));
		if (turn!.cancellationReceipt !== null)
			throw new Error("Conversation Stop cancellation winner omitted its atomic receipt");
		const turnStream = `conversation-computer-turn-${admission.target.bootstrapId}`;
		const turnHead = await this.history.readHead(turnStream);
		const activeStream = _ConversationComputerActiveTurnStreamName({ siloId: admission.command.siloId, computerId: admission.command.computerId, lease: { leaseId: admission.target.leaseId, leaseGeneration: admission.target.leaseGeneration } });
		const active = await _Last(this.history, activeStream);
		if (turnHead.revision === null || active === null || active.type !== _ACTIVE_EVENT || active.data["bootstrapId"] !== admission.target.bootstrapId)
			throw new Error("Conversation Stop admitted target lost its active pointer before a terminal decision");
		const conversationStream = `conversation-${admission.command.conversationId}`;
		const conversationHead = await this.history.readHead(conversationStream);
		if (conversationHead.revision === null)
			throw new Error("Conversation Stop requires immutable conversation genesis");
		const intent = _CancellationIntent(admission, turn!, turnHead.revision, conversationHead.revision, active.revision, this.turns);
		try
		{
			await this.history.appendAtomic(intent);
			return _Outcome(ConversationComputerStopDecisions.CancellationWon, true, null);
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const recovered = await this.recover(admission.command);
			if (recovered !== null)
				return recovered;
			const winner = await this.turns.load(admission.target.bootstrapId);
			if (winner !== null && winner.outputReceipt !== null)
				return this._recordOutputWinner(admission, ___DigestCanonicalJson(winner.outputReceipt as unknown as JsonValue));
			if (contentionCount >= _MAX_TARGET_CONTENTION_RETRIES)
				throw new Error("Conversation Stop target arbitration remained contended");
			return this._publishTarget(admission, contentionCount + 1);
		}
	}

	private async _recordOutputWinner(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, outputReceiptDigest: string): Promise<ConversationComputerStopPublishOutcome>
	{
		const outcome = _Outcome(ConversationComputerStopDecisions.OutputWon, true, outputReceiptDigest);
		const receipt = _Receipt(admission, outcome);
		const turnStream = `conversation-computer-turn-${admission.target.bootstrapId}`;
		const head = await this.history.readHead(turnStream);
		if (head.revision === null)
			throw new Error("Conversation Stop output winner omitted its turn stream");
		try
		{
			await this.history.appendAtomic({ expectedHeads: [{ streamName: turnStream, revision: head.revision }, { streamName: receipt.streamName, revision: 0n }], appends: [{ streamName: receipt.streamName, expectedRevision: 0n, events: [receipt.event] }] });
			return outcome;
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const recovered = await this.recover(admission.command);
			if (recovered !== null)
				return recovered;
			throw new Error("Conversation Stop output winner receipt remained contended");
		}
	}
}

function _CancellationIntent(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, turn: NonNullable<Awaited<ReturnType<KurrentConversationComputerTurnStore["load"]>>>, turnRevision: bigint, conversationRevision: bigint, activeRevision: bigint, turns: KurrentConversationComputerTurnStore)
{
	const outcome = _Outcome(ConversationComputerStopDecisions.CancellationWon, true, null);
	const receipt = _Receipt(admission, outcome);
	const entryId = _Uuid("stop-entry", admission.command.commandId);
	const parsed = ___ConversationEntrySchema.parse({ schemaVersion: 1, id: entryId, conversationId: admission.command.conversationId, position: (conversationRevision + 1n).toString(), author: { kind: ConversationAuthorKinds.System, systemId: "opencrane", name: "OpenCrane" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: admission.target.runId, causationId: admission.command.causationId, correlationId: admission.target.runId, idempotencyKey: entryId, occurredAt: admission.requestedAt, attestation: { serviceId: "opencrane", receiptId: receipt.event.id, domainStream: receipt.streamName, domainRevision: "1", decisionEvidenceId: null }, kind: ConversationEntryKinds.Log, logKind: "run", phase: "interrupted", summary: "Work stopped", detailsRef: null });
	if (parsed.kind !== ConversationEntryKinds.Log || parsed.logKind !== "run")
		throw new Error("Conversation Stop produced an invalid participant log");
	const entry: RunLogEntry = parsed;
	const turnStream = `conversation-computer-turn-${admission.target.bootstrapId}`;
	const cancelled: HistoryEvent = { id: admission.command.commandId, type: _CANCELLED_EVENT, data: { commandId: admission.command.commandId, commandDigest: admission.commandDigest, occurredAt: admission.requestedAt }, metadata: { bootstrapId: admission.target.bootstrapId } };
	const entryAppend = _ConversationHistoryEntryAppend({ siloId: admission.command.siloId, conversationId: admission.command.conversationId, expectedRevision: conversationRevision, entry });
	const settlementAppend = turns.settlementAppend(turn, activeRevision);
	return { expectedHeads: [{ streamName: turnStream, revision: turnRevision }, { streamName: receipt.streamName, revision: 0n }, { streamName: entryAppend.streamName, revision: entryAppend.expectedRevision }, { streamName: settlementAppend.streamName, revision: settlementAppend.expectedRevision }], appends: [{ streamName: turnStream, expectedRevision: turnRevision, events: [cancelled] }, { streamName: receipt.streamName, expectedRevision: 0n, events: [receipt.event] }, entryAppend, settlementAppend] };
}

function _Selection(selection: Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>)
{
	const streamName = _ReceiptStream(selection.command.commandId);
	const event: HistoryEvent = { id: _Uuid("stop-selection", selection.command.commandId), type: _SELECTION_EVENT, data: { selection }, metadata: { siloId: selection.command.siloId, conversationId: selection.command.conversationId, commandId: selection.command.commandId } };
	return { streamName, event };
}

function _Receipt(admission: ConversationComputerStopAdmission, outcome: ConversationComputerStopPublishOutcome)
{
	const streamName = _ReceiptStream(admission.command.commandId);
	const event: HistoryEvent = { id: _Uuid("stop-receipt", admission.command.commandId), type: _RECEIPT_EVENT, data: { admission, outcome }, metadata: { siloId: admission.command.siloId, conversationId: admission.command.conversationId, commandId: admission.command.commandId } };
	return { streamName, event };
}

function _ReadReceipt(event: HistoryRecordedEvent, command: ConversationComputerStopCommand): ConversationComputerStopPublishOutcome
{
	if (event.streamName !== _ReceiptStream(command.commandId) || event.type !== _RECEIPT_EVENT || event.id !== _Uuid("stop-receipt", command.commandId))
		throw new Error("Conversation Stop receipt has invalid stream coordinates");
	const { admission, outcome } = _ConversationComputerStopReceiptSchema.parse(event.data);
	const expectedRevision = admission.kind === ConversationComputerStopAdmissionKinds.NoTarget ? 0n : 1n;
	if (event.revision !== expectedRevision)
		throw new Error("Conversation Stop receipt has invalid revision");
	if (___DigestCanonicalJson(admission.command as unknown as JsonValue) !== ___DigestCanonicalJson(command as unknown as JsonValue) || !_StoredDecision(outcome.decision))
		throw new Error("Conversation Stop receipt differs from its command");
	return { ...outcome, published: false };
}

function _ReadSelection(event: HistoryRecordedEvent, command: ConversationComputerStopCommand): ConversationComputerStopSelection
{
	if (event.streamName !== _ReceiptStream(command.commandId) || event.revision !== 0n)
		throw new Error("Conversation Stop selection has invalid stream coordinates");
	if (event.type === _RECEIPT_EVENT)
	{
		const selection = _ConversationComputerStopReceiptSchema.parse(event.data).admission;
		if (selection.kind !== ConversationComputerStopAdmissionKinds.NoTarget || ___DigestCanonicalJson(selection.command as unknown as JsonValue) !== ___DigestCanonicalJson(command as unknown as JsonValue))
			throw new Error("Conversation Stop no-target selection differs from its command");
		return selection;
	}
	if (event.type !== _SELECTION_EVENT || event.id !== _Uuid("stop-selection", command.commandId))
		throw new Error("Conversation Stop selection has invalid event coordinates");
	const selection = _ConversationComputerStopSelectionSchema.parse(event.data["selection"]);
	_AssertSelectionCommand(selection, command);
	return selection;
}

function _AssertSelectionCommand(selection: ConversationComputerStopSelection, command: ConversationComputerStopCommand): void
{
	if (___DigestCanonicalJson(selection.command as unknown as JsonValue) !== ___DigestCanonicalJson(command as unknown as JsonValue))
		throw new Error("Conversation Stop selection differs from its command");
	const digestInput = selection.kind === ConversationComputerStopAdmissionKinds.NoTarget
		? { command: selection.command, activeTurnStreamName: selection.activeTurnStreamName, activeTurnExpectedRevision: selection.activeTurnExpectedRevision }
		: { command: selection.command, target: selection.target, originalTurnTask: selection.originalTurnTask };
	if (selection.commandDigest !== ___DigestCanonicalJson(digestInput as unknown as JsonValue))
		throw new Error("Conversation Stop selection digest differs from its target");
}

function _StoredDecision(value: unknown): value is ConversationComputerStopDecisions
{
	return value === ConversationComputerStopDecisions.NoTarget || value === ConversationComputerStopDecisions.CancellationWon || value === ConversationComputerStopDecisions.OutputWon;
}

function _AssertReceiptAdmission(event: HistoryRecordedEvent, admission: ConversationComputerStopAdmission): void
{
	if (___DigestCanonicalJson(event.data["admission"] as JsonValue) !== ___DigestCanonicalJson(admission as unknown as JsonValue))
		throw new Error("Conversation Stop receipt differs from its admitted target");
}

function _AssertSelectionAdmission(selection: Extract<ConversationComputerStopSelection, { kind: ConversationComputerStopAdmissionKinds.Target }>, admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>): void
{
	const selected = { command: selection.command, commandDigest: selection.commandDigest, target: selection.target, originalTurnTask: selection.originalTurnTask, authorizationDecisionDigest: selection.authorizationDecisionDigest };
	const admitted = { command: admission.command, commandDigest: admission.commandDigest, target: admission.target, originalTurnTask: admission.originalTurnTask, authorizationDecisionDigest: selection.authorizationDecisionDigest };
	if (___DigestCanonicalJson(selected as unknown as JsonValue) !== ___DigestCanonicalJson(admitted as unknown as JsonValue))
		throw new Error("Conversation Stop admission differs from its selected target");
}

function _AssertTarget(admission: Extract<ConversationComputerStopAdmission, { kind: ConversationComputerStopAdmissionKinds.Target }>, turn: Awaited<ReturnType<KurrentConversationComputerTurnStore["load"]>>): void
{
	if (turn === null || turn.bootstrapId !== admission.target.bootstrapId || turn.siloId !== admission.command.siloId || turn.computerId !== admission.command.computerId || turn.lease.leaseId !== admission.target.leaseId || turn.lease.leaseGeneration !== admission.target.leaseGeneration || turn.compile.runId !== admission.target.runId || turn.compile.attempt !== admission.target.attempt || BigInt(turn.latestPendingEntryPosition) >= BigInt(admission.command.causationPosition))
		throw new Error("Conversation Stop target differs from its frozen turn");
}

function _Outcome(decision: ConversationComputerStopDecisions, published: boolean, outputReceiptDigest: string | null): ConversationComputerStopPublishOutcome { return { decision, published, outputReceiptDigest }; }
function _ReceiptStream(commandId: string): string { return `conversation-computer-stop-${commandId}`; }

async function _First(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent | null>
{
	for await (const event of history.readStream({ streamName, fromRevision: 0n, maxCount: 1 }))
		return event;
	return null;
}

async function _TerminalRequired(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent>
{
	const event = await _Terminal(history, streamName);
	if (event === null)
		throw new Error("Conversation Stop receipt disappeared during recovery");
	return event;
}

async function _Terminal(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent | null>
{
	for await (const event of history.readStream({ streamName, fromRevision: 0n, maxCount: 2 }))
	{
		if (event.type === _RECEIPT_EVENT)
			return event;
	}
	return null;
}

async function _Last(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent | null>
{
	let last: HistoryRecordedEvent | null = null;
	for await (const event of history.readStream({ streamName }))
		last = event;
	return last;
}

function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
