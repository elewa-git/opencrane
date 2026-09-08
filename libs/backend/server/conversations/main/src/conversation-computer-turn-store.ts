import { createHash } from "node:crypto";
import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _ConversationComputerActiveTurnStreamName } from "./conversation-computer-activity";
import type { ConversationComputerToolReservation, ConversationComputerTurnOutputReceipt, ConversationComputerTurnStore, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import type { ConversationComputerLeaseCoordinates } from "./conversation-computers";
import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals } from "./conversation-tool-proposal.types";

const _FROZEN_EVENT = "opencrane.conversation-computer-turn-frozen.v1";
const _OUTPUT_EVENT = "opencrane.conversation-computer-turn-output.v1";
const _TOOL_RESERVED_EVENT = "opencrane.conversation-computer-turn-tool-reserved.v1";
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

	/** Load the immutable input anchor and the mutually exclusive output or tool decision. */
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
				if (event.type === _TOOL_RESERVED_EVENT)
					frozen = { ...current, toolReservation: _ToolReservation(event, bootstrapId) };
				else
				{
					const receipt = _Output(event, bootstrapId);
					frozen = { ...current, outputSourceCommandId: receipt.sourceCommandId, outputReceipt: receipt };
				}
			}
			else throw new Error("Conversation computer turn history is noncontiguous");
		}
		return frozen;
	}

	/**
	 * Reserve a proposal before database admission using the same checked revision as output.
	 *
	 * The reservation survives response loss and database refusal. A later refusal does not prove
	 * that an earlier request failed to commit. Only authoritative outcome reconciliation may settle
	 * the reserved work; neither a retry nor a fresh model response can erase it.
	 * A resolved append can acknowledge a reused event ID, so stored-decision readback precedes SQL.
	 * Called by: ConversationComputerTurnAuthority.proposeTool.
	 */
	public async reserveTool(bootstrapId: string, reservation: ConversationComputerToolReservation): Promise<void>
	{
		const existing = await this.load(bootstrapId);
		if (existing === null || existing.outputReceipt !== null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		if (existing.toolReservation !== null)
			return _AssertSameReservation(existing.toolReservation, reservation);
		const event = { id: _ReservationEventId(bootstrapId, reservation), type: _TOOL_RESERVED_EVENT, data: { bootstrapId, proposalId: reservation.proposalId, requestFingerprint: reservation.requestFingerprint }, metadata: { bootstrapId } };
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
		if (winner?.toolReservation === null || winner === null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		_AssertSameReservation(winner.toolReservation, reservation);
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

	/** Verify the stored output receipt after append; an event-ID acknowledgement alone cannot defeat a tool reservation. */
	public async markOutput(bootstrapId: string, receipt: ConversationComputerTurnOutputReceipt): Promise<"accepted" | "idempotent">
	{
		let outcome: "accepted" | "idempotent" = "accepted";
		try
		{
			await this.history.append({ streamName: _Stream(bootstrapId), expectedRevision: 0n, events: [{ id: receipt.sourceCommandId, type: _OUTPUT_EVENT, data: { bootstrapId, ...receipt }, metadata: { bootstrapId } }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError))
				throw error;
			outcome = "idempotent";
		}
		const existing = await this.load(bootstrapId);
		if (existing === null || existing.toolReservation !== null || existing.outputReceipt === null || !_SameReceipt(existing.outputReceipt, receipt))
			throw new Error("Conversation computer turn does not record this output decision");
		return outcome;
	}

	/** Release the active-turn pointer only after run completion and credential revocation converge. */
	public async settle(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const events = await _Events(this.history, _ActiveStream(turn));
		if (events.at(-1)?.type === _SETTLED_EVENT)
			return;
		try
		{
			await this.history.append({ streamName: _ActiveStream(turn), expectedRevision: BigInt(events.length - 1), events: [{ id: _Uuid("settled", turn.bootstrapId), type: _SETTLED_EVENT, data: { bootstrapId: turn.bootstrapId }, metadata: _Metadata(turn) }] });
		}
		catch (error)
		{
			if (!(error instanceof WrongExpectedVersionError) || await this.loadActive(turn) !== null)
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

function _SameReceipt(left: ConversationComputerTurnOutputReceipt, right: ConversationComputerTurnOutputReceipt): boolean
{
	return left.sourceCommandId === right.sourceCommandId && left.blockId === right.blockId && left.payloadRef === right.payloadRef && left.ciphertextDigest === right.ciphertextDigest;
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
 * The event keeps the lease flat under its original names (`generation`, `leaseId`, `sandboxClaimId`),
 * so every turn already stored in KurrentDB keeps loading unchanged.
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
		sandboxClaimId: turn.lease.sandboxClaimId,
		compile: { runId: turn.compile.runId, attempt: turn.compile.attempt, promptCompilerVersion: turn.compile.promptCompilerVersion, digest: turn.compile.digest },
	};
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: turn.lease.leaseGeneration, bootstrapId: turn.bootstrapId };
}

/** Shape of the frozen event data as it is stored: the lease flattened to `generation`, `leaseId` and `sandboxClaimId`, and the stream revision as a string. */
type _StoredFrozenTurn = Omit<FrozenConversationComputerTurn, "lease" | "binding" | "outputSourceCommandId" | "outputReceipt" | "toolReservation"> & { readonly generation: number; readonly leaseId: string; readonly sandboxClaimId: string; readonly binding: Omit<FrozenConversationComputerTurn["binding"], "expectedRevision"> & { readonly expectedRevision: string } };

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
		lease: { leaseId: value.leaseId, leaseGeneration: value.generation, sandboxClaimId: value.sandboxClaimId },
		binding: { ...value.binding, expectedRevision: BigInt(value.binding.expectedRevision) },
		latestPendingEntryId: value.latestPendingEntryId,
		modelAlias: value.modelAlias,
		maximumBudgetUsd: value.maximumBudgetUsd,
		credentialLifetimeSeconds: value.credentialLifetimeSeconds,
		compile: value.compile,
		outputSourceCommandId: null,
		outputReceipt: null,
		toolReservation: null,
	};
}

function _ToolReservation(event: HistoryRecordedEvent, bootstrapId: string): ConversationComputerToolReservation
{
	const proposalId = event.data["proposalId"];
	const requestFingerprint = event.data["requestFingerprint"];
	if (event.streamName !== _Stream(bootstrapId) || event.data["bootstrapId"] !== bootstrapId || event.metadata["bootstrapId"] !== bootstrapId
		|| typeof proposalId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u.test(proposalId)
		|| typeof requestFingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(requestFingerprint))
		throw new Error("Conversation computer turn received an invalid tool reservation");
	const reservation = { proposalId, requestFingerprint };
	if (event.id !== _ReservationEventId(bootstrapId, reservation))
		throw new Error("Conversation computer tool reservation has a different event identity");
	return reservation;
}

function _ReservationEventId(bootstrapId: string, reservation: ConversationComputerToolReservation): string
{
	return _Uuid("tool-reservation", JSON.stringify([bootstrapId, reservation.proposalId, reservation.requestFingerprint]));
}

function _AssertSameReservation(existing: ConversationComputerToolReservation, requested: ConversationComputerToolReservation): void
{
	if (existing.proposalId !== requested.proposalId || existing.requestFingerprint !== requested.requestFingerprint)
		throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Conflict);
}

function _Output(event: HistoryRecordedEvent, bootstrapId: string): ConversationComputerTurnOutputReceipt
{
	const sourceCommandId = event.data["sourceCommandId"];
	const blockId = event.data["blockId"];
	const payloadRef = event.data["payloadRef"];
	const ciphertextDigest = event.data["ciphertextDigest"];
	if (event.type !== _OUTPUT_EVENT || event.streamName !== _Stream(bootstrapId) || event.data["bootstrapId"] !== bootstrapId || event.metadata["bootstrapId"] !== bootstrapId || typeof sourceCommandId !== "string" || typeof blockId !== "string" || typeof payloadRef !== "string" || typeof ciphertextDigest !== "string" || event.id !== sourceCommandId)
		throw new Error("Conversation computer turn received an invalid output event");
	return { sourceCommandId, blockId, payloadRef, ciphertextDigest };
}
