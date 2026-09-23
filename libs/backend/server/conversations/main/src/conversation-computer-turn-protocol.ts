import { createHash } from "node:crypto";

import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Names the terminal event that may claim any next private turn-protocol position. */
export const _CONVERSATION_COMPUTER_TURN_UNAVAILABLE_EVENT = "opencrane.conversation-computer-turn-unavailable.v1";

/** Stable private protocol states derived from the durable turn fields. */
enum _TurnProtocolStates
{
	/** The turn exists but no model request has been reserved. */
	Frozen = "frozen",
	/** The first model request is reserved and may produce output or select a tool. */
	ModelReserved = "model_reserved",
	/** The selected tool is durable but the final model request is not reserved. */
	ToolSelected = "tool_selected",
	/** The final model request is reserved and may produce output. */
	ContinuationReserved = "continuation_reserved",
}

/** Identifies which durable coordinate fences unavailable at one protocol state. */
enum _DecisionFenceSources
{
	/** Uses the deterministic turn identifier before model reservation. */
	Bootstrap = "bootstrap",
	/** Uses the first model invocation fence. */
	Model = "model",
	/** Uses the selected proposal identifier before continuation reservation. */
	Tool = "tool",
	/** Uses the final model invocation fence. */
	Continuation = "continuation",
}

/** Describes one state-owned next-write position and whether that state can emit output. */
type _ProtocolCell = {
	readonly expectedRevision: bigint;
	readonly decisionFenceSource: _DecisionFenceSources;
	readonly permitsOutput: boolean;
};

/** Exhaustively owns the next legal write position for every non-terminal private state. */
const _PROTOCOL_CELLS: Readonly<Record<_TurnProtocolStates, _ProtocolCell>> = {
	[_TurnProtocolStates.Frozen]: {
		expectedRevision: 0n,
		decisionFenceSource: _DecisionFenceSources.Bootstrap,
		permitsOutput: false,
	},
	[_TurnProtocolStates.ModelReserved]: {
		expectedRevision: 1n,
		decisionFenceSource: _DecisionFenceSources.Model,
		permitsOutput: true,
	},
	[_TurnProtocolStates.ToolSelected]: {
		expectedRevision: 2n,
		decisionFenceSource: _DecisionFenceSources.Tool,
		permitsOutput: false,
	},
	[_TurnProtocolStates.ContinuationReserved]: {
		expectedRevision: 3n,
		decisionFenceSource: _DecisionFenceSources.Continuation,
		permitsOutput: true,
	},
};

/** Derive the one non-terminal protocol state represented by the durable progress fields. */
function _State(turn: FrozenConversationComputerTurn): _TurnProtocolStates
{
	if (turn.continuationReservation !== null)
		return _TurnProtocolStates.ContinuationReserved;
	if (turn.toolSelection !== null)
		return _TurnProtocolStates.ToolSelected;
	if (turn.modelReservation !== null)
		return _TurnProtocolStates.ModelReserved;
	return _TurnProtocolStates.Frozen;
}

/** Resolve the state-owned terminal fence without allowing nullable-field fallbacks. */
function _DecisionFence(turn: FrozenConversationComputerTurn, source: _DecisionFenceSources): string
{
	switch (source)
	{
		case _DecisionFenceSources.Bootstrap:
			return turn.bootstrapId;

		case _DecisionFenceSources.Model:
			if (turn.modelReservation === null)
				throw new Error("Conversation computer model protocol fence is missing");
			return turn.modelReservation.invocationFence;

		case _DecisionFenceSources.Tool:
			if (turn.toolSelection === null)
				throw new Error("Conversation computer tool protocol fence is missing");
			return turn.toolSelection.proposalId;

		case _DecisionFenceSources.Continuation:
			if (turn.continuationReservation === null)
				throw new Error("Conversation computer continuation protocol fence is missing");
			return turn.continuationReservation.invocationFence;
	}
}

/** Return the exact model reservation permitted to produce output in the current state. */
export function _ConversationComputerOutputReservation(turn: FrozenConversationComputerTurn)
{
	const state = _State(turn);
	const cell = _PROTOCOL_CELLS[state];
	if (!cell.permitsOutput)
		throw new Error("Conversation computer cannot complete unresolved tool work");
	const reservation = state === _TurnProtocolStates.ContinuationReserved ? turn.continuationReservation : turn.modelReservation;
	if (reservation === null)
		throw new Error("Conversation computer output reservation is missing");
	return reservation;
}

/** Return the checked-append revision owned by output in the current state. */
export function _ConversationComputerOutputExpectedRevision(turn: FrozenConversationComputerTurn): bigint
{
	const state = _State(turn);
	const cell = _PROTOCOL_CELLS[state];
	if (!cell.permitsOutput)
		throw new Error("Conversation computer cannot complete unresolved tool work");
	return cell.expectedRevision;
}

/** Build unavailable for the current next position so protocol progress and cleanup share one CAS. */
export function _ConversationComputerUnavailableDecision(turn: FrozenConversationComputerTurn)
{
	const cell = _PROTOCOL_CELLS[_State(turn)];
	const decisionFence = _DecisionFence(turn, cell.decisionFenceSource);
	return {
		expectedRevision: cell.expectedRevision,
		event: {
			id: _ConversationComputerTurnEventId("unavailable", `${cell.expectedRevision}:${decisionFence}`),
			type: _CONVERSATION_COMPUTER_TURN_UNAVAILABLE_EVENT,
			data: { bootstrapId: turn.bootstrapId, decisionFence },
			metadata: _ConversationComputerTurnMetadata(turn),
		},
	};
}

/** Validate unavailable against the state cell that owned this event position. */
export function _ReadConversationComputerUnavailable(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): true
{
	const decision = _ConversationComputerUnavailableDecision(turn);
	const metadata = Object.fromEntries(Object.entries(decision.event.metadata).map(([key, value]) => [key, String(value)]));
	if (event.type !== decision.event.type || event.id !== decision.event.id || event.streamName !== _ConversationComputerTurnStream(turn.bootstrapId) || event.revision !== decision.expectedRevision + 1n || ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(decision.event.data as unknown as JsonValue) || ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(metadata as JsonValue))
		throw new Error("Conversation computer turn received an invalid unavailable decision");
	return true;
}

/** Build the metadata shared by all private turn and active-pointer events. */
export function _ConversationComputerTurnMetadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return {
		siloId: turn.siloId,
		computerId: turn.computerId,
		leaseId: turn.lease.leaseId,
		generation: turn.lease.leaseGeneration,
		bootstrapId: turn.bootstrapId,
	};
}

/** Derive one RFC-4122 event identifier from a closed protocol coordinate. */
export function _ConversationComputerTurnEventId(domain: string, value: string): string
{
	const hex = createHash("sha256").update(`${domain}:${value}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

/** Validate and derive the private turn stream name from its deterministic identifier. */
export function _ConversationComputerTurnStream(bootstrapId: string): string
{
	if (!/^[0-9a-f-]{36}$/iu.test(bootstrapId))
		throw new Error("Conversation computer turn requires a UUID bootstrap identifier");
	return `conversation-computer-turn-${bootstrapId}`;
}
