import { ConversationComputerTurnProtocolStates, type ConversationComputerTurnModelReservation, type ConversationComputerTurnProtocolProjection, type ConversationComputerTurnToolResult, type ConversationComputerTurnToolSelection, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/** Builds empty progress for application composition tests that replace the history adapter. */
export function _OpenConversationTurnProtocol(): ConversationComputerTurnProtocolProjection
{
	return {
		state: ConversationComputerTurnProtocolStates.Open, revision: 0n, steps: [],
		accounting: { reservedModelCalls: 0, reservedCompletionTokens: 0, reservedToolInvocations: 0, toolResultCyclesFed: 0 },
		modelRetry: null, output: null, unavailable: null, cancellation: null,
	};
}

/** Saves a model request in a composition double; real concurrency is tested by the history owner. */
export function _ReserveConversationTurnModel(turn: FrozenConversationComputerTurn, reservation: ConversationComputerTurnModelReservation): FrozenConversationComputerTurn
{
	const state = ConversationComputerTurnProtocolStates.ModelReserved;
	const previous = turn.protocol;
	const fedResult = previous.steps.at(-1)?.result != null;
	return { ...turn, protocol: { ...previous, state, revision: previous.revision + 1n,
		steps: [...previous.steps, { state, reservation, selection: null, result: null }],
		accounting: { ...previous.accounting, reservedModelCalls: previous.accounting.reservedModelCalls + 1,
			reservedCompletionTokens: previous.accounting.reservedCompletionTokens + reservation.maxCompletionTokens,
			toolResultCyclesFed: previous.accounting.toolResultCyclesFed + Number(fedResult) },
	} };
}

/** Saves the latest selected tool in an application composition double. */
export function _SelectConversationTurnTool(turn: FrozenConversationComputerTurn, selection: ConversationComputerTurnToolSelection): FrozenConversationComputerTurn
{
	const step = turn.protocol.steps.at(-1);
	if (step === undefined)
		throw new Error("Composition fixture requires a saved model reservation");
	const state = ConversationComputerTurnProtocolStates.ToolPending;
	return { ...turn, protocol: { ...turn.protocol, state, revision: turn.protocol.revision + 1n,
		steps: [...turn.protocol.steps.slice(0, -1), { state, reservation: step.reservation, selection, result: null }],
		accounting: { ...turn.protocol.accounting, reservedToolInvocations: turn.protocol.accounting.reservedToolInvocations + 1 },
	} };
}

/** Retains one private result reference in a composition double without spending a model call. */
export function _RecordConversationTurnResult(turn: FrozenConversationComputerTurn, result: ConversationComputerTurnToolResult): FrozenConversationComputerTurn
{
	const step = turn.protocol.steps.at(-1);
	if (step?.selection == null)
		throw new Error("Composition fixture requires a selected tool");
	const state = ConversationComputerTurnProtocolStates.ResultReady;
	return { ...turn, protocol: { ...turn.protocol, state, revision: turn.protocol.revision + 1n,
		steps: [...turn.protocol.steps.slice(0, -1), { state, reservation: step.reservation, selection: step.selection, result }],
	} };
}

/** Encodes the public saved-reservation fields for SQL tests using the real Kurrent adapter. */
export function _ConversationTurnRequest(turn: FrozenConversationComputerTurn, reservation: Omit<ConversationComputerTurnModelReservation, "requestDigest" | "historyDigest" | "compiledInputDigest">): ConversationComputerTurnModelReservation
{
	const history = turn.protocol.steps.flatMap(step => step.result === null ? [] : [{ ordinal: step.reservation.ordinal,
		proposalId: step.result.proposalId, toolInvocationId: step.result.toolInvocationId,
		resultDigest: step.result.resultDigest, exchange: step.result.exchange }]);
	const { invocationFence, ...limits } = reservation;
	const facts = { ...limits, compiledInputDigest: turn.compile.digest, historyDigest: ___DigestCanonicalJson(history as unknown as JsonValue) };
	const requestDigest = ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, runId: turn.compile.runId,
		attempt: turn.compile.attempt, modelAlias: turn.modelAlias,
		budget: turn.budget, ...facts } as unknown as JsonValue);
	return { invocationFence, ...facts, requestDigest };
}
