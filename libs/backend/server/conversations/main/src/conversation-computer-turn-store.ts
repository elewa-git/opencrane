import { _CONVERSATION_TOOL_SELECTED_EVENT, _ConversationToolSelectionEvent, _ReadConversationToolSelection } from "./conversation-computer-tool-selection";
import type { ConversationComputerContinuationReservation, ConversationComputerToolSelection } from "./conversation-computer-continuation.types";
import { _ConversationModelReservationEvent, _ReadConversationModelReservation, _ReadConversationContinuationReservation } from "./conversation-computer-model-reservation";
import type { ConversationComputerModelReservation } from "./conversation-computer-model.types";
import { createHash } from "node:crypto";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ReadBoundConversationWriterIntent } from "./bound-conversation-writer";
import { _ConversationComputerActiveTurnStreamName } from "./conversation-computer-activity";
import type { ConversationComputerOutputDecision, ConversationComputerTurnOutputReceipt, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import type { ConversationComputerLeaseCoordinates } from "./conversation-computers";
import { _ValidatedConversationComputerRealization } from "./conversation-computers";

const _FROZEN_EVENT = "opencrane.conversation-computer-turn-frozen.v1";
const _OUTPUT_EVENT = "opencrane.conversation-computer-turn-output.v2";
const _ACTIVE_EVENT = "opencrane.conversation-computer-turn-active.v1";
const _SETTLED_EVENT = "opencrane.conversation-computer-turn-settled.v1";

/** Persists immutable turn coordinates, a compile digest, and terminal output coordinates in a deterministic Kurrent stream; compiled content never enters it. */
export class KurrentConversationComputerTurnStore implements ConversationComputerTurnStore
{
	public constructor(private readonly history: Pick<HistoryStore, "append" | "readStream">) {}

	/** Create the deterministic turn stream or return the byte-equivalent frozen turn. */
	public async createOrRead(turn: FrozenConversationComputerTurn): Promise<FrozenConversationComputerTurn>
	{
		let result = turn;
		try
		{
			await this.history.append({ streamName: _Stream(turn.bootstrapId), expectedRevision: HistoryExpectedRevisions.NoStream, events: [{ id: turn.bootstrapId, type: _FROZEN_EVENT, data: { turn: _Serializable(turn) }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			const existing = await this.load(turn.bootstrapId);
			if (existing === null)
				throw new Error("Conversation computer turn conflict omitted its frozen event");
			result = existing;
		}
		await this._Activate(result);
		return result;
	}

	/** Load the contiguous private protocol; only the final answer reaches participant history. */
	public async load(bootstrapId: string): Promise<FrozenConversationComputerTurn | null>
	{
		let frozen: FrozenConversationComputerTurn | null = null;
		for await (const event of this.history.readStream({ streamName: _Stream(bootstrapId) }))
		{
			if (event.revision === 0n)
				frozen = _Frozen(event, bootstrapId);
			else if (event.revision === 1n && frozen !== null)
				{
				const current: FrozenConversationComputerTurn = frozen;
				frozen = { ...current, modelReservation: _ReadConversationModelReservation(event, current) };
			}
			else if (event.revision === 2n && frozen !== null && frozen.modelReservation !== null)
			{
				const current: FrozenConversationComputerTurn = frozen;
				if (event.type === _CONVERSATION_TOOL_SELECTED_EVENT)
					frozen = { ...current, toolSelection: _ReadConversationToolSelection(event, current) };
				else
				{
					const receipt = _Output(event, current);
					frozen = { ...current, outputSourceCommandId: receipt.event.id, outputReceipt: receipt };
				}
			}
			else if (event.revision === 3n && frozen !== null && frozen.toolSelection !== null)
				{
				const current: FrozenConversationComputerTurn = frozen;
				frozen = { ...current, continuationReservation: _ReadConversationContinuationReservation(event, current) };
			}
			else if (event.revision === 4n && frozen !== null && frozen.continuationReservation !== null)
			{
				const current: FrozenConversationComputerTurn = frozen;
				const receipt = _Output(event, current);
				frozen = { ...current, outputSourceCommandId: receipt.event.id, outputReceipt: receipt };
			}
			else throw new Error("Conversation computer turn history is noncontiguous");
		}
		return frozen;
	}

	/** Save one exact encrypted declaration reference before its existing SQL tool admission. */
	public async selectTool(bootstrapId: string, selection: ConversationComputerToolSelection): Promise<void>
	{
		const turn = await this.load(bootstrapId);
		if (turn === null || turn.outputReceipt !== null || turn.continuationReservation !== null)
			throw new Error("Conversation computer cannot select another tool");
		const event = _ConversationToolSelectionEvent(turn, selection);
		_ReadConversationToolSelection({ ...event, streamName: _Stream(bootstrapId), revision: 2n, recordedAt: new Date() } as HistoryRecordedEvent, turn);
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 1n, events: [event] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		const winner = await this.load(bootstrapId);
		if (winner?.toolSelection === null || winner === null || ___DigestCanonicalJson(winner.toolSelection as unknown as JsonValue) !== ___DigestCanonicalJson(selection as unknown as JsonValue))
			throw new Error("Conversation computer tool selection differs from its stored winner");
	}

	/** Consume the final request before result acknowledgement; a restart never adopts its fence. */
	public async reserveContinuation(bootstrapId: string, reservation: ConversationComputerContinuationReservation): Promise<boolean>
	{
		const turn = await this.load(bootstrapId);
		if (turn === null || turn.toolSelection === null || turn.continuationReservation !== null || turn.outputReceipt !== null)
			return false;
		const event = _ConversationModelReservationEvent(turn, reservation);
		_ReadConversationContinuationReservation({ ...event, streamName: _Stream(bootstrapId), revision: 3n, recordedAt: new Date() } as HistoryRecordedEvent, turn);
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 2n, events: [event] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		const winner = await this.load(bootstrapId);
		return winner?.continuationReservation !== null && winner !== null
			&& ___DigestCanonicalJson(winner.continuationReservation as unknown as JsonValue) === ___DigestCanonicalJson(reservation as unknown as JsonValue);
	}

	/**
	 * Consume the first model allowance at revision 1 and verify the complete stored reservation.
	 * A duplicate event-id acknowledgement is not enough: the stored fields must match this call's
	 * fresh fence. A reservation present when this method starts always returns false.
	 * Called by: ConversationComputerTurnAuthority.modelStep.
	 */
	public async reserveModel(bootstrapId: string, reservation: ConversationComputerModelReservation): Promise<boolean>
	{
		const turn = await this.load(bootstrapId);
		if (turn === null || turn.modelReservation !== null || turn.toolSelection !== null || turn.outputReceipt !== null)
			return false;
		const event = _ConversationModelReservationEvent(turn, reservation);
		_ReadConversationModelReservation({ ...event, streamName: _Stream(bootstrapId), revision: 1n, recordedAt: new Date() } as HistoryRecordedEvent, turn);
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 0n, events: [event] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		const winner = await this.load(bootstrapId);
		return winner?.modelReservation !== null && winner !== null
			&& ___DigestCanonicalJson(winner.modelReservation as unknown as JsonValue) === ___DigestCanonicalJson(reservation as unknown as JsonValue);
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
		return active === null ? null : await this.load(active);
	}

	/** Save the full intent before history append, then return the exact stored winner for this command. */
	public async markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<ConversationComputerOutputDecision>
	{
		const requested = structuredClone(receipt);
		const turn = await this.load(bootstrapId);
		if (turn === null)
			throw new Error("Conversation computer turn does not record this output decision");
		const reservation = _OutputReservation(turn);
		const intent = _OutputIntent(turn, requested);
		let outcome: ConversationComputerOutputDecision["outcome"] = turn.outputReceipt === null ? "accepted" : "idempotent";
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: reservation.ordinal === 1 ? 1n : 3n, events: [{ id: intent.event.id, type: _OUTPUT_EVENT, data: { bootstrapId, modelInvocationFence: reservation.invocationFence, intent }, metadata: { bootstrapId } }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			outcome = "idempotent";
		}
		const existing = await this.load(bootstrapId);
		if (existing === null || existing.outputReceipt === null || !_SameReceipt(existing.outputReceipt, intent))
			throw new Error("Conversation computer turn does not record this output decision");
		return { outcome, receipt: existing.outputReceipt };
	}

	/** Release the active-turn pointer only after run completion and credential revocation converge. */
	public async settle(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const streamName = _ActiveStream(turn);
		const events = await _Events(this.history, streamName);
		if (_HasSettlement(events, turn))
			return;
		const last = events.at(-1);
		if (last?.type !== _ACTIVE_EVENT || _ActiveBootstrap(last, turn) !== turn.bootstrapId)
			throw new Error("Conversation computer cannot settle a different active turn");
		try
		{
			await this.history.append({ streamName, expectedRevision: last.revision, events: [{ id: _Uuid("settled", turn.bootstrapId), type: _SETTLED_EVENT, data: { bootstrapId: turn.bootstrapId }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
		}
		if (!_HasSettlement(await _Events(this.history, streamName), turn))
			throw new Error("Conversation computer cannot confirm its own settlement");
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

/** Recognise this turn's exact settlement even after another turn has taken the lease pointer. */
function _HasSettlement(events: readonly HistoryRecordedEvent[], turn: FrozenConversationComputerTurn): boolean
{
	const metadata = Object.fromEntries(Object.entries(_Metadata(turn)).map(([key, value]) => [key, String(value)]));
	return events.some(function _Matches(event, index)
	{
		if (event.type !== _SETTLED_EVENT || event.id !== _Uuid("settled", turn.bootstrapId))
			return false;
		const prior = events[index - 1];
		return prior?.type === _ACTIVE_EVENT && _ActiveBootstrap(prior, turn) === turn.bootstrapId
			&& event.streamName === _ActiveStream(turn) && event.revision === prior.revision + 1n
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

function _ActiveStream(command: ConversationComputerLeaseCoordinates): string
{
	return _ConversationComputerActiveTurnStreamName(command);
}

/** Reads the bootstrap id off an active event after checking the event names this exact lease. */
function _ActiveBootstrap(event: HistoryRecordedEvent, command: ConversationComputerLeaseCoordinates): string
{
	const bootstrapId = event.data["bootstrapId"];
	if (typeof bootstrapId !== "string" || event.data["siloId"] !== command.siloId || event.data["computerId"] !== command.computerId || event.data["generation"] !== command.lease.leaseGeneration || event.data["leaseId"] !== command.lease.leaseId)
		throw new Error("Conversation computer active-turn history crossed its lease fence");
	return bootstrapId;
}

function _Uuid(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

/** Only independent server timestamps may differ for concurrent preparations of one command. */
function _SameReceipt(left: ConversationComputerTurnOutputReceipt, right: ConversationComputerTurnOutputReceipt): boolean
{
	return _OutputCommandDigest(left) === _OutputCommandDigest(right);
}

/** Compare all saved event fields except the preparation clock; the stored clock always wins. */
function _OutputCommandDigest(intent: ConversationComputerTurnOutputReceipt): string
{
	return ___DigestCanonicalJson({ ...intent, event: { ...intent.event, data: { entry: { ...intent.event.data.entry, occurredAt: null } } } } as unknown as JsonValue);
}

function _Stream(bootstrapId: string): string
{
	if (!/^[0-9a-f-]{36}$/iu.test(bootstrapId))
		throw new Error("Conversation computer turn requires a UUID bootstrap identifier");
	return `conversation-computer-turn-${bootstrapId}`;
}

/**
 * Copy the frozen record field by field; a spread could leak an unexpected property into the immutable event.
 *
 * The initial event contains only immutable input and lease coordinates; later events own progress.
 */
function _Serializable(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return {
		bootstrapId: turn.bootstrapId,
		siloId: turn.siloId,
		computerId: turn.computerId,
		generation: turn.lease.leaseGeneration,
		leaseId: turn.lease.leaseId,
		binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() },
		latestPendingEntryId: turn.latestPendingEntryId,
		modelAlias: turn.modelAlias,
		maximumBudgetUsd: turn.maximumBudgetUsd,
		credentialLifetimeSeconds: turn.credentialLifetimeSeconds,
		realization: turn.lease.realization,
		compile: { runId: turn.compile.runId, attempt: turn.compile.attempt, promptCompilerVersion: turn.compile.promptCompilerVersion, digest: turn.compile.digest },
	};
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: turn.lease.leaseGeneration, bootstrapId: turn.bootstrapId };
}

/** Shape of the frozen event data with its realization discriminant and string stream revision. */
type _StoredFrozenTurn = Omit<FrozenConversationComputerTurn, "lease" | "binding" | "outputSourceCommandId" | "outputReceipt" | "toolSelection" | "continuationReservation" | "modelReservation"> & { readonly generation: number; readonly leaseId: string; readonly realization: FrozenConversationComputerTurn["lease"]["realization"]; readonly binding: Omit<FrozenConversationComputerTurn["binding"], "expectedRevision"> & { readonly expectedRevision: string } };

/** Rebuild the in-memory record from the stored event, gathering the flat lease fields into the `lease` bundle. */
function _Frozen(event: HistoryRecordedEvent, bootstrapId: string): FrozenConversationComputerTurn
{
	if (event.type !== _FROZEN_EVENT || event.id !== bootstrapId || event.streamName !== _Stream(bootstrapId))
		throw new Error("Conversation computer turn received an invalid frozen event");
	const value = event.data["turn"] as _StoredFrozenTurn;
	if (value?.bootstrapId !== bootstrapId || typeof value.binding?.expectedRevision !== "string" || typeof value.compile?.digest !== "string" || typeof value.compile.runId !== "string" || typeof value.compile.attempt !== "number" || typeof value.compile.promptCompilerVersion !== "string")
		throw new Error("Conversation computer turn received malformed frozen data");
	return {
		bootstrapId: value.bootstrapId,
		siloId: value.siloId,
		computerId: value.computerId,
		lease: { leaseId: value.leaseId, leaseGeneration: value.generation, realization: _ValidatedConversationComputerRealization(value.realization) },
		binding: { ...value.binding, expectedRevision: BigInt(value.binding.expectedRevision) },
		latestPendingEntryId: value.latestPendingEntryId,
		modelAlias: value.modelAlias,
		maximumBudgetUsd: value.maximumBudgetUsd,
		credentialLifetimeSeconds: value.credentialLifetimeSeconds,
		compile: value.compile,
		outputSourceCommandId: null,
		outputReceipt: null,
		toolSelection: null,
		continuationReservation: null,
		modelReservation: null,
	};
}

/** Read one complete output decision and validate it against this frozen turn. */
function _Output(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnOutputReceipt
{
	const reservation = _OutputReservation(turn);
	if (event.data["modelInvocationFence"] !== reservation.invocationFence || event.type !== _OUTPUT_EVENT || event.streamName !== _Stream(turn.bootstrapId) || event.data["bootstrapId"] !== turn.bootstrapId || event.metadata["bootstrapId"] !== turn.bootstrapId)
		throw new Error("Conversation computer turn received an invalid output event");
	const intent = _OutputIntent(turn, event.data["intent"]);
	if (event.id !== intent.event.id
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, modelInvocationFence: reservation.invocationFence, intent } as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId }))
		throw new Error("Conversation computer output decision has a different event identity");
	return intent;
}

/** Require a completed text answer whose event id matches the server's model reservation. */
function _OutputIntent(turn: FrozenConversationComputerTurn, value: unknown): ConversationComputerTurnOutputReceipt
{
	const intent = _ReadBoundConversationWriterIntent(turn.binding, value);
	const entry = intent.event.data.entry;
	if (intent.event.id !== _OutputReservation(turn).invocationFence || entry.kind !== "message" || entry.state !== "completed" || entry.blocks.length !== 1 || entry.blocks[0].kind !== "text"
		|| entry.replyToEntryId !== turn.latestPendingEntryId || entry.addressedAgentIdentityId !== null || entry.activation !== "none"
		|| entry.visibility.audience !== "conversation" || entry.causationId !== turn.latestPendingEntryId || entry.correlationId !== turn.latestPendingEntryId)
		throw new Error("Conversation computer output decision has a different answer shape");
	return intent;
}

/** Only the first direct answer or the reserved post-tool answer can complete the turn. */
function _OutputReservation(turn: FrozenConversationComputerTurn)
{
	const reservation = turn.continuationReservation ?? turn.modelReservation;
	if (reservation === null || turn.toolSelection !== null && turn.continuationReservation === null)
		throw new Error("Conversation computer cannot complete unresolved tool work");
	return reservation;
}
