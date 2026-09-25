import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { ___ParseRunBudgetPolicy } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import { _ConversationComputerActiveTurnStreamName } from "../lifecycle/conversation-computer-activity";
import { __ReadConversationGeneratedFileOutput } from "./generated-output/conversation-generated-file-output";
import { _CONVERSATION_MODEL_RESERVED_EVENT, _ReadConversationModelReservation } from "./conversation-computer-model-reservation";
import { _ClaimPersistedConversationModelRetry, _CONVERSATION_MODEL_REJECTED_EVENT, _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT, _ReadConversationModelRetryEvent, _RecordConversationModelRejection, _ReserveConversationModel } from "./conversation-computer-model-retry-store";
import type { ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "./conversation-computer-model-retry.types";
import { _CONVERSATION_TOOL_SELECTED_EVENT, _ConversationToolSelectionEvent, _ReadConversationToolSelection } from "./conversation-computer-tool-selection";
import { _CONVERSATION_TOOL_RESULT_RECORDED_EVENT, _ConversationToolResultEvent, _ReadConversationToolResult } from "./conversation-computer-tool-result";
import { _InitialConversationComputerTurnProtocol, _ReduceConversationComputerTurnProtocol } from "./conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolEvents, ConversationComputerTurnProtocolStates } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnCancellationReceipt, ConversationComputerTurnModelReservation, ConversationComputerTurnOutputReceipt, ConversationComputerTurnProtocolEvent, ConversationComputerTurnToolResult, ConversationComputerTurnToolSelection, ConversationComputerTurnUnavailableReceipt } from "./conversation-computer-turn-protocol.types";
import { _ConversationComputerTurnCancellationReceiptSchema } from "./conversation-computer-turn-cancellation.validator";
import { _CONVERSATION_TURN_RESPONSE_UNAVAILABLE_EVENT, _ConversationTurnUnavailableEvent, _ReadConversationTurnUnavailable } from "./conversation-computer-turn-unavailable";
import type { ConversationComputerLeaseCoordinates } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerOutputDecision, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import { _ConversationComputerOutputIntents, _ReadConversationComputerOutputReceipt, _SameConversationComputerOutputReceipt } from "./output/conversation-computer-output-receipt";

const _FROZEN_EVENT = "opencrane.conversation-computer-turn-frozen.v2";
/** Records the complete primary answer and optional adjacent display in one output decision. */
const _OUTPUT_EVENT = "opencrane.conversation-computer-turn-output.v4";
const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
const _SETTLED_EVENT = "opencrane.conversation-computer-turn-settled.v1";
const _CANCELLED_EVENT = "opencrane.conversation-computer-turn-cancelled.v2";

/** Reports that newer conversation history won the output position before the atomic commit. */
export class ConversationComputerOutputPositionConflictError extends Error {}

/**
 * Persists ordered turn events and active-pointer decisions in KurrentDB.
 *
 * The pure protocol reducer owns every legal transition and aggregate allowance. This adapter owns
 * serialization, contiguous replay, compare-and-set appends, exact readback and atomic output or
 * cancellation writes. It never dispatches a model or tool and never decrypts private history.
 *
 * Called by: conversation turn composition, output recovery and the Stop publisher.
 */
export class KurrentConversationComputerTurnStore implements ConversationComputerTurnStore
{
	public constructor(private readonly history: Pick<HistoryStore, "append" | "appendAtomic" | "readStream">) {}

	/** Create the deterministic frozen turn or recover its byte-equivalent winner. */
	public async createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>
	{
		_AssertInitial(turn);
		let result = turn;
		try
		{
			await this.history.append({ streamName: _Stream(turn.bootstrapId), expectedRevision: HistoryExpectedRevisions.NoStream, events: [_FrozenEvent(turn)] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(turn.bootstrapId);
			if (existing === null || !_SameFrozenTurn(existing, turn))
				throw new Error("Conversation computer turn conflict differs from its frozen event");
			result = existing;
		}
		await this._Activate(result);
		return result;
	}

	/** Load and validate every contiguous event through the pure ordered protocol. */
	public async load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>
	{
		let turn: FrozenConversationComputerTurn | null = null;
		for await (const event of this.history.readStream({ streamName: _Stream(bootstrapId) }))
		{
			if (turn === null)
			{
				turn = _Frozen(event, bootstrapId);
				continue;
			}
			turn = _ApplyRecordedEvent(turn, event);
		}
		return turn;
	}

	/** Reserve one model request; only the process that appended its fresh fence may dispatch. */
	public async reserveModel(bootstrapId: string, reservation: ConversationComputerTurnModelReservation): Promise<boolean>
	{
		return _ReserveConversationModel({ history: this.history, load: this.load.bind(this) }, bootstrapId, reservation);
	}

	/** Save or recover no-forward evidence without acquiring dispatch permission. */
	public async recordModelRejection(bootstrapId: string, rejection: ConversationComputerModelRejection): Promise<void>
	{
		return _RecordConversationModelRejection({ history: this.history, load: this.load.bind(this) }, bootstrapId, rejection);
	}

	/** Allow only this call's acknowledged fresh retry claim to own a physical send. */
	public async claimModelRetry(bootstrapId: string, claim: ConversationComputerModelRetryClaim): Promise<boolean>
	{
		return _ClaimPersistedConversationModelRetry({ history: this.history, load: this.load.bind(this) }, bootstrapId, claim);
	}

	/** Reserve one per-step tool proposal, or recover the identical saved selection. */
	public async selectTool(bootstrapId: string, selection: ConversationComputerTurnToolSelection): Promise<void>
	{
		const initial = await this.load(bootstrapId);
		if (initial === null)
			throw new Error("Conversation computer tool selection requires its frozen turn");
		if (initial.protocol.state !== ConversationComputerTurnProtocolStates.ModelReserved)
		{
			if (_Same(initial.protocol.steps.at(-1)?.selection, selection))
				return;
			throw new Error("Conversation computer cannot select a tool from its current state");
		}
		const event = _ConversationToolSelectionEvent(initial, selection);
		const checked = _ReadConversationToolSelection(_RecordedCandidate(event, initial.protocol.revision + 1n, bootstrapId), initial);
		_ApplyProtocol(initial, { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection: checked });
		await this._AppendOrRecover(initial, event);
		const winner = await this.load(bootstrapId);
		if (winner === null || !_Same(winner.protocol.steps.at(-1)?.selection, selection))
			throw new Error("Conversation computer tool selection differs from its stored winner");
	}

	/** Record one private result exchange without consuming a loop cycle. */
	public async recordToolResult(bootstrapId: string, result: ConversationComputerTurnToolResult): Promise<void>
	{
		const initial = await this.load(bootstrapId);
		if (initial === null)
			throw new Error("Conversation computer tool result requires its frozen turn");
		if (initial.protocol.state !== ConversationComputerTurnProtocolStates.ToolPending)
		{
			if (_Same(initial.protocol.steps.at(-1)?.result, result))
				return;
			throw new Error("Conversation computer cannot record a tool result from its current state");
		}
		const event = _ConversationToolResultEvent(initial, result);
		const checked = _ReadConversationToolResult(_RecordedCandidate(event, initial.protocol.revision + 1n, bootstrapId), initial);
		_ApplyProtocol(initial, { kind: ConversationComputerTurnProtocolEvents.ToolResultRecorded, result: checked });
		await this._AppendOrRecover(initial, event);
		const winner = await this.load(bootstrapId);
		if (winner === null || !_Same(winner.protocol.steps.at(-1)?.result, result))
			throw new Error("Conversation computer tool result differs from its stored winner");
	}

	/** Record one bounded unavailable decision while preserving all spent reservations. */
	public async markResponseUnavailable(bootstrapId: string, receipt: ConversationComputerTurnUnavailableReceipt): Promise<void>
	{
		const initial = await this.load(bootstrapId);
		if (initial === null)
			throw new Error("Conversation computer unavailable result requires its frozen turn");
		if (initial.protocol.state === ConversationComputerTurnProtocolStates.ResponseUnavailable)
		{
			if (_Same(initial.protocol.unavailable, receipt))
				return;
			throw new Error("Conversation computer unavailable result differs from its stored winner");
		}
		const event = _ConversationTurnUnavailableEvent(initial, receipt);
		const checked = _ReadConversationTurnUnavailable(_RecordedCandidate(event, initial.protocol.revision + 1n, bootstrapId), initial);
		_ApplyProtocol(initial, { kind: ConversationComputerTurnProtocolEvents.ResponseUnavailable, receipt: checked });
		await this._AppendOrRecover(initial, event);
		const winner = await this.load(bootstrapId);
		if (winner === null || !_Same(winner.protocol.unavailable, receipt))
			throw new Error("Conversation computer unavailable result differs from its stored winner");
	}

	/** Resolve the unsettled turn named by this exact computer lease. */
	public async loadActive(command: ConversationComputerLeaseCoordinates): Promise<FrozenConversationComputerTurn | null>
	{
		let active: string | null = null;
		for await (const event of this.history.readStream({ streamName: _ActiveStream(command) }))
		{
			if (event.type === _ACTIVE_EVENT)
				active = _ActiveBootstrap(event, command);
			else if (event.type === _SETTLED_EVENT && event.data["bootstrapId"] === active)
				active = null;
			else throw new Error("Conversation computer active-turn history is invalid");
		}
		return active === null ? null : this.load(active);
	}

	/** Atomically commit the current model step's final output and participant history. */
	public async markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<ConversationComputerOutputDecision>
	{
		const requested = structuredClone(receipt);
		const turn = await this.load(bootstrapId);
		if (turn === null)
			throw new Error("Conversation computer turn does not record this output decision");
		if (turn.protocol.output !== null)
		{
			if (!_SameConversationComputerOutputReceipt(turn.protocol.output.receipt, requested))
				throw new Error("Conversation computer turn already has a different output");
			return { outcome: "idempotent", receipt: turn.protocol.output.receipt };
		}
		const reservation = _CurrentReservation(turn);
		const intent = _ReadConversationComputerOutputReceipt(turn, requested, reservation.invocationFence);
		const output = { kind: ConversationComputerTurnProtocolEvents.OutputRecorded, ordinal: reservation.ordinal, modelInvocationFence: reservation.invocationFence, sourceCommandId: reservation.invocationFence, receipt: intent } as const;
		const protocol = _ReduceConversationComputerTurnProtocol(turn.protocol, output, turn.budget);
		__ReadConversationGeneratedFileOutput({ ...turn, protocol });
		const event = _OutputEvent(turn, intent, reservation.ordinal, reservation.invocationFence);
		const conversationRevision = BigInt(intent.expectedRevision);
		let outcome: ConversationComputerOutputDecision["outcome"] = "accepted";
		try
		{
			await this.history.appendAtomic({ expectedHeads: [{ streamName: _Stream(bootstrapId), revision: turn.protocol.revision }, { streamName: intent.streamName, revision: conversationRevision }], appends: [{ streamName: _Stream(bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }, { streamName: intent.streamName, expectedRevision: conversationRevision, events: _ConversationComputerOutputIntents(intent).map(part => part.event) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			outcome = "idempotent";
		}
		const winner = await this.load(bootstrapId);
		if (winner?.protocol.output === null || winner === null)
			throw new ConversationComputerOutputPositionConflictError("Conversation computer output position changed before its atomic commit");
		if (!_SameConversationComputerOutputReceipt(winner.protocol.output.receipt, intent))
			throw new Error("Conversation computer turn does not record this output decision");
		return { outcome, receipt: winner.protocol.output.receipt };
	}

	/** Release the active-turn pointer only after terminal cleanup converges. */
	public async settle(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const streamName = _ActiveStream(turn);
		const events = await _Events(this.history, streamName);
		if (_HasSettlement(events, turn))
			return;
		const last = events.at(-1);
		if (last?.type !== _ACTIVE_EVENT || _ActiveBootstrap(last, turn) !== turn.bootstrapId)
			throw new Error("Conversation computer cannot settle a different active turn");
		try { await this.history.append(this.settlementAppend(turn, last.revision)); }
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		if (!_HasSettlement(await _Events(this.history, streamName), turn))
			throw new Error("Conversation computer cannot confirm its own settlement");
	}

	/** Prepare Stop cancellation and active settlement at the reducer-owned next revision. */
	public cancellationAppends(turn: FrozenConversationComputerTurn, receipt: ConversationComputerTurnCancellationReceipt, activeRevision: bigint): readonly [HistoryAppend, HistoryAppend]
	{
		const checked = _ConversationComputerTurnCancellationReceiptSchema.parse(receipt);
		const protocolEvent = { kind: ConversationComputerTurnProtocolEvents.Cancelled, receipt: checked } as const;
		_ReduceConversationComputerTurnProtocol(turn.protocol, protocolEvent, turn.budget);
		const event = _CancellationEvent(turn, checked);
		_ReadCancellation(_RecordedCandidate(event, turn.protocol.revision + 1n, turn.bootstrapId), turn);
		return [{ streamName: _Stream(turn.bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }, this.settlementAppend(turn, activeRevision)];
	}

	/** Build the active-pointer settlement shared by completion and cancellation. */
	private settlementAppend(turn: FrozenConversationComputerTurn, expectedRevision: bigint): HistoryAppend
	{
		if (expectedRevision < 0n)
			throw new Error("Conversation computer settlement requires an existing active pointer");
		return { streamName: _ActiveStream(turn), expectedRevision, events: [{ id: _ConversationComputerEventId("settled", turn.bootstrapId), type: _SETTLED_EVENT, data: { bootstrapId: turn.bootstrapId }, metadata: _Metadata(turn) }] };
	}

	private async _AppendOrRecover(turn: FrozenConversationComputerTurn, event: { readonly id: string; readonly type: string; readonly data: Record<string, unknown>; readonly metadata: Record<string, unknown> }): Promise<void>
	{
		try { await this.history.append({ streamName: _Stream(turn.bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }); }
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
	}

	private async _Activate(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const streamName = _ActiveStream(turn);
		const events = await _Events(this.history, streamName);
		const last = events.at(-1);
		if (last?.type === _ACTIVE_EVENT && last.data["bootstrapId"] === turn.bootstrapId)
			return;
		if (last?.type === _ACTIVE_EVENT)
			throw new Error("Conversation computer already has an unsettled turn");
		try
		{
			await this.history.append({ streamName, expectedRevision: events.length === 0 ? HistoryExpectedRevisions.NoStream : BigInt(events.length - 1), events: [{ id: turn.bootstrapId, type: _ACTIVE_EVENT, data: { bootstrapId: turn.bootstrapId, siloId: turn.siloId, computerId: turn.computerId, generation: turn.lease.leaseGeneration, leaseId: turn.lease.leaseId }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			const active = error instanceof WrongExpectedVersionError ? await this.loadActive(turn) : null;
			if (active?.bootstrapId !== turn.bootstrapId)
				throw error;
		}
	}
}

function _ApplyRecordedEvent(turn: FrozenConversationComputerTurn, event: HistoryRecordedEvent): FrozenConversationComputerTurn
{
	let protocolEvent: ConversationComputerTurnProtocolEvent;
	if (event.type === _CONVERSATION_MODEL_RESERVED_EVENT)
		protocolEvent = { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: _ReadConversationModelReservation(event, turn) };
	else if (event.type === _CONVERSATION_MODEL_REJECTED_EVENT || event.type === _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT)
		protocolEvent = _ReadConversationModelRetryEvent(event, turn);
	else if (event.type === _CONVERSATION_TOOL_SELECTED_EVENT)
		protocolEvent = { kind: ConversationComputerTurnProtocolEvents.ToolSelected, selection: _ReadConversationToolSelection(event, turn) };
	else if (event.type === _CONVERSATION_TOOL_RESULT_RECORDED_EVENT)
		protocolEvent = { kind: ConversationComputerTurnProtocolEvents.ToolResultRecorded, result: _ReadConversationToolResult(event, turn) };
	else if (event.type === _OUTPUT_EVENT)
		protocolEvent = _ReadOutput(event, turn);
	else if (event.type === _CONVERSATION_TURN_RESPONSE_UNAVAILABLE_EVENT)
		protocolEvent = { kind: ConversationComputerTurnProtocolEvents.ResponseUnavailable, receipt: _ReadConversationTurnUnavailable(event, turn) };
	else if (event.type === _CANCELLED_EVENT)
		protocolEvent = { kind: ConversationComputerTurnProtocolEvents.Cancelled, receipt: _ReadCancellation(event, turn) };
	else throw new Error("Conversation computer turn history contains an unknown event");
	const result = _ApplyProtocol(turn, protocolEvent);
	if (result.protocol.state === ConversationComputerTurnProtocolStates.OutputRecorded)
		__ReadConversationGeneratedFileOutput(result);
	return result;
}

function _ApplyProtocol(turn: FrozenConversationComputerTurn, event: ConversationComputerTurnProtocolEvent): FrozenConversationComputerTurn
{
	return { ...turn, protocol: _ReduceConversationComputerTurnProtocol(turn.protocol, event, turn.budget) };
}

function _FrozenEvent(turn: FrozenConversationComputerTurn)
{
	return { id: turn.bootstrapId, type: _FROZEN_EVENT, data: { turn: _Serializable(turn) }, metadata: _Metadata(turn) };
}

type _StoredFrozenTurn = Omit<FrozenConversationComputerTurn, "lease" | "binding" | "protocol" | "budget"> & { readonly generation: number; readonly leaseId: string; readonly sandboxClaimId: string; readonly binding: Omit<FrozenConversationComputerTurn["binding"], "expectedRevision"> & { readonly expectedRevision: string }; readonly budget: unknown };

function _Frozen(event: HistoryRecordedEvent, bootstrapId: string): FrozenConversationComputerTurn
{
	if (event.revision !== 0n || event.type !== _FROZEN_EVENT || event.id !== bootstrapId || event.streamName !== _Stream(bootstrapId))
		throw new Error("Conversation computer turn received an invalid frozen event");
	const value = event.data["turn"] as _StoredFrozenTurn;
	if (value?.bootstrapId !== bootstrapId || typeof value.binding?.expectedRevision !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value.binding.expectedRevision)
		|| typeof value.latestPendingEntryPosition !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value.latestPendingEntryPosition)
		|| typeof value.compile?.digest !== "string" || typeof value.compile.runId !== "string" || typeof value.compile.attempt !== "number" || typeof value.compile.promptCompilerVersion !== "string")
		throw new Error("Conversation computer turn received malformed frozen data");
	const budget = ___ParseRunBudgetPolicy(value.budget);
	const turn: FrozenConversationComputerTurn = {
		bootstrapId: value.bootstrapId, siloId: value.siloId, computerId: value.computerId,
		lease: { leaseId: value.leaseId, leaseGeneration: value.generation, sandboxClaimId: value.sandboxClaimId },
		binding: { ...value.binding, expectedRevision: BigInt(value.binding.expectedRevision) },
		latestPendingEntryId: value.latestPendingEntryId, latestPendingEntryPosition: value.latestPendingEntryPosition,
		modelAlias: value.modelAlias, maximumBudgetUsd: value.maximumBudgetUsd, credentialLifetimeSeconds: value.credentialLifetimeSeconds,
		compile: value.compile, budget, protocol: _InitialConversationComputerTurnProtocol(),
	};
	const expected = _FrozenEvent(turn);
	if (___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer frozen event crossed its exact coordinates");
	return turn;
}

function _Serializable(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return {
		bootstrapId: turn.bootstrapId, siloId: turn.siloId, computerId: turn.computerId,
		generation: turn.lease.leaseGeneration, leaseId: turn.lease.leaseId, sandboxClaimId: turn.lease.sandboxClaimId,
		binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() },
		latestPendingEntryId: turn.latestPendingEntryId, latestPendingEntryPosition: turn.latestPendingEntryPosition,
		modelAlias: turn.modelAlias, maximumBudgetUsd: turn.maximumBudgetUsd, credentialLifetimeSeconds: turn.credentialLifetimeSeconds,
		compile: { ...turn.compile }, budget: { ...turn.budget },
	};
}

function _AssertInitial(turn: FrozenConversationComputerTurn): void
{
	___ParseRunBudgetPolicy(turn.budget);
	const protocol = turn.protocol;
	if (protocol.state !== ConversationComputerTurnProtocolStates.Open || protocol.revision !== 0n || protocol.steps.length !== 0
		|| protocol.accounting.reservedModelCalls !== 0 || protocol.accounting.reservedCompletionTokens !== 0
		|| protocol.accounting.reservedToolInvocations !== 0 || protocol.accounting.toolResultCyclesFed !== 0
		|| protocol.output !== null || protocol.unavailable !== null || protocol.cancellation !== null || protocol.modelRetry !== null)
		throw new Error("Conversation computer frozen turn must start with an empty protocol");
}

function _OutputEvent(turn: FrozenConversationComputerTurn, intent: ConversationComputerTurnOutputReceipt, ordinal: number, fence: string)
{
	return { id: intent.event.id, type: _OUTPUT_EVENT, data: { bootstrapId: turn.bootstrapId, ordinal, modelInvocationFence: fence, intent }, metadata: _Metadata(turn) };
}

function _ReadOutput(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): Extract<ConversationComputerTurnProtocolEvent, { readonly kind: ConversationComputerTurnProtocolEvents.OutputRecorded }>
{
	const reservation = _CurrentReservation(turn);
	const intent = _ReadConversationComputerOutputReceipt(turn, event.data["intent"], reservation.invocationFence);
	const expected = _OutputEvent(turn, intent, reservation.ordinal, reservation.invocationFence);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.id !== expected.id || event.type !== expected.type
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer output decision crossed its exact event fence");
	return { kind: ConversationComputerTurnProtocolEvents.OutputRecorded, ordinal: reservation.ordinal, modelInvocationFence: reservation.invocationFence, sourceCommandId: reservation.invocationFence, receipt: intent };
}

function _CurrentReservation(turn: FrozenConversationComputerTurn): ConversationComputerTurnModelReservation
{
	const current = turn.protocol.steps.at(-1);
	if (turn.protocol.state !== ConversationComputerTurnProtocolStates.ModelReserved || current?.state !== ConversationComputerTurnProtocolStates.ModelReserved)
		throw new Error("Conversation computer cannot complete unresolved turn work");
	return current.reservation;
}

function _CancellationEvent(turn: FrozenConversationComputerTurn, receipt: ConversationComputerTurnCancellationReceipt)
{
	return { id: receipt.commandId, type: _CANCELLED_EVENT, data: { bootstrapId: turn.bootstrapId, receipt }, metadata: _Metadata(turn) };
}

function _ReadCancellation(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnCancellationReceipt
{
	const receipt = _ConversationComputerTurnCancellationReceiptSchema.parse(event.data["receipt"]);
	const expected = _CancellationEvent(turn, receipt);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.id !== expected.id || event.type !== expected.type
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer cancellation crossed its exact event fence");
	return receipt;
}

function _RecordedCandidate(event: { readonly id: string; readonly type: string; readonly data: Record<string, unknown>; readonly metadata: Record<string, unknown> }, revision: bigint, bootstrapId: string): HistoryRecordedEvent
{
	return { ...event, streamName: _Stream(bootstrapId), revision, recordedAt: new Date() } as HistoryRecordedEvent;
}

function _Same(left: unknown, right: unknown): boolean
{
	if (left === undefined || right === undefined)
		return left === right;
	return ___DigestCanonicalJson(left as JsonValue) === ___DigestCanonicalJson(right as JsonValue);
}

function _SameFrozenTurn(left: FrozenConversationComputerTurn, right: FrozenConversationComputerTurn): boolean
{
	return _Same(_Serializable(left), _Serializable(right));
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}

function _Stream(bootstrapId: string): string
{
	if (!/^[0-9a-f-]{36}$/iu.test(bootstrapId))
		throw new Error("Conversation computer turn requires a UUID bootstrap identifier");
	return `conversation-computer-turn-${bootstrapId}`;
}

function _ActiveStream(command: ConversationComputerLeaseCoordinates): string
{
	return _ConversationComputerActiveTurnStreamName(command);
}

function _ActiveBootstrap(event: HistoryRecordedEvent, command: ConversationComputerLeaseCoordinates): string
{
	const bootstrapId = event.data["bootstrapId"];
	if (typeof bootstrapId !== "string" || event.data["siloId"] !== command.siloId || event.data["computerId"] !== command.computerId || event.data["generation"] !== command.lease.leaseGeneration || event.data["leaseId"] !== command.lease.leaseId)
		throw new Error("Conversation computer active-turn history crossed its lease fence");
	return bootstrapId;
}

function _HasSettlement(events: readonly HistoryRecordedEvent[], turn: FrozenConversationComputerTurn): boolean
{
	const metadata = Object.fromEntries(Object.entries(_Metadata(turn)).map(([key, value]) => [key, String(value)]));
	return events.some(function _Matches(event, index)
	{
		if (event.type !== _SETTLED_EVENT || event.id !== _ConversationComputerEventId("settled", turn.bootstrapId))
			return false;
		const prior = events[index - 1];
		return prior?.type === _ACTIVE_EVENT && _ActiveBootstrap(prior, turn) === turn.bootstrapId && event.streamName === _ActiveStream(turn) && event.revision === prior.revision + 1n
			&& ___DigestCanonicalJson(event.data as JsonValue) === ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId })
			&& ___DigestCanonicalJson(event.metadata as JsonValue) === ___DigestCanonicalJson(metadata);
	});
}

async function _Events(history: Pick<HistoryStore, "readStream">, streamName: string): Promise<HistoryRecordedEvent[]>
{
	const events: HistoryRecordedEvent[] = [];
	for await (const event of history.readStream({ streamName }))
		events.push(event);
	return events;
}
