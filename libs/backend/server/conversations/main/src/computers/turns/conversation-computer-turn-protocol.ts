import { ConversationModelToolModes } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ClaimConversationModelRetry, _RejectConversationModel } from "./conversation-computer-model-retry";

import { ConversationComputerTurnProtocolEvents, ConversationComputerTurnProtocolStates, ConversationComputerTurnUnavailableReasons } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnBudget, ConversationComputerTurnProtocolEvent, ConversationComputerTurnProtocolProjection, ConversationComputerTurnStep } from "./conversation-computer-turn-protocol.types";

/** Applies one event to one current state without external I/O. */
type _ProtocolHandler = (projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget) => ConversationComputerTurnProtocolProjection;
/** Requires every protocol event to have an explicit handler in each state. */
type _ProtocolHandlers = Record<ConversationComputerTurnProtocolEvents, _ProtocolHandler>;

/**
 * Creates the only valid projection before the first ordered-step event.
 *
 * Called by: the Kurrent turn store when it decodes a frozen turn.
 *
 * @returns Empty revision-zero protocol state with no consumed allowance.
 */
export function _InitialConversationComputerTurnProtocol(): ConversationComputerTurnProtocolProjection
{
	return { state: ConversationComputerTurnProtocolStates.Open, revision: 0n, steps: [], accounting: { reservedModelCalls: 0, reservedCompletionTokens: 0, reservedToolInvocations: 0, toolResultCyclesFed: 0 }, modelRetry: null, output: null, unavailable: null, cancellation: null };
}

/**
 * Applies one event through the exhaustive State × Event registry.
 *
 * The reducer owns ordering and aggregate accounting only. It never appends history, checks a live
 * lease, decrypts model content, admits a tool, dispatches an effect or writes participant history.
 *
 * Called by: KurrentConversationComputerTurnStore during replay and before every append.
 *
 * @param projection Complete state derived from the preceding contiguous events.
 * @param event The one proposed or replayed protocol event.
 * @param budget Validated immutable allowance copied from the admitted run snapshot.
 * @returns A new projection with the event applied exactly once.
 * @throws Error when the State × Event cell, step identity, deadline or aggregate allowance is invalid.
 */
export function _ReduceConversationComputerTurnProtocol(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	_AssertBudget(budget);
	return _HANDLERS[projection.state][event.kind](projection, event, budget);
}

/** Binds every saved private exchange in step order without including its plaintext. */
export function _ConversationComputerTurnHistoryDigest(steps: readonly ConversationComputerTurnStep[]): string
{
	const history = steps.flatMap(function _Result(step)
	{
		return step.result === null ? [] : [{ ordinal: step.reservation.ordinal, proposalId: step.result.proposalId, toolInvocationId: step.result.toolInvocationId, resultDigest: step.result.resultDigest, exchange: step.result.exchange }];
	});
	return ___DigestCanonicalJson(history as unknown as JsonValue);
}

/** Fills unaccepted State × Event cells with the same closed rejection. */
function _Handlers(overrides: Partial<_ProtocolHandlers>): _ProtocolHandlers
{
	return {
		[ConversationComputerTurnProtocolEvents.ModelReserved]: _Reject,
		[ConversationComputerTurnProtocolEvents.ModelRejected]: _Reject,
		[ConversationComputerTurnProtocolEvents.ModelRetryClaimed]: _Reject,
		[ConversationComputerTurnProtocolEvents.ToolSelected]: _Reject,
		[ConversationComputerTurnProtocolEvents.ToolResultRecorded]: _Reject,
		[ConversationComputerTurnProtocolEvents.OutputRecorded]: _Reject,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _Reject,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Reject,
		...overrides,
	};
}

/** Makes every State × Event decision visible and compile-time exhaustive. */
const _HANDLERS: Record<ConversationComputerTurnProtocolStates, _ProtocolHandlers> = {
	[ConversationComputerTurnProtocolStates.Open]: _Handlers({
		[ConversationComputerTurnProtocolEvents.ModelReserved]: _ReserveModel,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _MarkUnavailable,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel,
	}),
	[ConversationComputerTurnProtocolStates.ModelReserved]: _Handlers({
		[ConversationComputerTurnProtocolEvents.ModelRejected]: _RecordModelRejection,
		[ConversationComputerTurnProtocolEvents.ToolSelected]: _SelectTool,
		[ConversationComputerTurnProtocolEvents.OutputRecorded]: _RecordOutput,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _MarkUnavailable,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel,
	}),
	[ConversationComputerTurnProtocolStates.ModelRetryWaiting]: _Handlers({
		[ConversationComputerTurnProtocolEvents.ModelRetryClaimed]: _RecordRetryClaim,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _MarkUnavailable,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel,
	}),
	[ConversationComputerTurnProtocolStates.ToolPending]: _Handlers({
		[ConversationComputerTurnProtocolEvents.ToolResultRecorded]: _RecordToolResult,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _MarkUnavailable,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel,
	}),
	[ConversationComputerTurnProtocolStates.ResultReady]: _Handlers({
		[ConversationComputerTurnProtocolEvents.ModelReserved]: _ReserveModel,
		[ConversationComputerTurnProtocolEvents.ResponseUnavailable]: _MarkUnavailable,
		[ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel,
	}),
	[ConversationComputerTurnProtocolStates.ResponseUnavailable]: _Handlers({ [ConversationComputerTurnProtocolEvents.Cancelled]: _Cancel }),
	[ConversationComputerTurnProtocolStates.OutputRecorded]: _Handlers({}),
	[ConversationComputerTurnProtocolStates.Cancelled]: _Handlers({}),
};

/** Adds one unique model step after checking aggregate and result-cycle allowance. */
function _ReserveModel(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.ModelReserved)
		return _Reject(projection, event, budget);
	const reservation = event.reservation;
	const expectedOrdinal = projection.steps.length + 1;
	const feedsResult = projection.state === ConversationComputerTurnProtocolStates.ResultReady ? 1 : 0;
	const previous = projection.steps.at(-1);
	const latestAuthorityDeadline = previous === undefined ? budget.wallClockDeadlineEpochMs : Math.min(previous.reservation.authorityExpiresAtEpochMs, previous.result?.authorityExpiresAtEpochMs ?? Number.MAX_SAFE_INTEGER);
	const accounting = {
		...projection.accounting,
		reservedModelCalls: projection.accounting.reservedModelCalls + 1,
		reservedCompletionTokens: projection.accounting.reservedCompletionTokens + reservation.maxCompletionTokens,
		toolResultCyclesFed: projection.accounting.toolResultCyclesFed + feedsResult,
	};
	if (!_Positive(reservation.ordinal) || reservation.ordinal !== expectedOrdinal || !_Identifier(reservation.invocationFence)
		|| !_Digest(reservation.compiledInputDigest) || !_Digest(reservation.historyDigest) || !_Digest(reservation.requestDigest)
		|| !_Positive(reservation.maxCompletionTokens) || !_Positive(reservation.authorityExpiresAtEpochMs) || !_Positive(reservation.dispatchDeadlineEpochMs)
		|| reservation.dispatchDeadlineEpochMs > reservation.authorityExpiresAtEpochMs || reservation.authorityExpiresAtEpochMs > budget.wallClockDeadlineEpochMs
		|| reservation.authorityExpiresAtEpochMs > latestAuthorityDeadline
		|| projection.steps.some(step => step.reservation.invocationFence === reservation.invocationFence)
		|| reservation.historyDigest !== _ConversationComputerTurnHistoryDigest(projection.steps)
		|| accounting.reservedModelCalls > budget.maxModelTurns || accounting.reservedCompletionTokens > budget.maxCompletionTokens || accounting.toolResultCyclesFed > budget.maxLoopIterations)
		throw new Error("Conversation computer model reservation crossed its ordered allowance");
	if (reservation.tools === ConversationModelToolModes.Select)
	{
		const hasFinalModel = accounting.reservedModelCalls < budget.maxModelTurns;
		const hasFinalToken = accounting.reservedCompletionTokens < budget.maxCompletionTokens;
		const hasTool = accounting.reservedToolInvocations < budget.maxToolInvocations;
		const hasCycle = accounting.toolResultCyclesFed < budget.maxLoopIterations;
		if (!hasFinalModel || !hasFinalToken || !hasTool || !hasCycle)
			throw new Error("Conversation computer tool selection did not preserve its final model allowance");
	}
	else if (reservation.tools !== ConversationModelToolModes.None)
		throw new Error("Conversation computer model reservation has an unknown tool mode");
	const step: ConversationComputerTurnStep = { state: ConversationComputerTurnProtocolStates.ModelReserved, reservation, selection: null, result: null };
	return { ...projection, state: ConversationComputerTurnProtocolStates.ModelReserved, revision: projection.revision + 1n, steps: [...projection.steps, step], accounting, modelRetry: null };
}

/** Delegates physical rejection continuity without changing the reserved logical step. */
function _RecordModelRejection(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	return event.kind === ConversationComputerTurnProtocolEvents.ModelRejected ? _RejectConversationModel(projection, event.rejection) : _Reject(projection, event, budget);
}

/** Delegates the bounded fresh-nonce claim while keeping State × Event admission explicit. */
function _RecordRetryClaim(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	return event.kind === ConversationComputerTurnProtocolEvents.ModelRetryClaimed ? _ClaimConversationModelRetry(projection, event.claim) : _Reject(projection, event, budget);
}

/** Binds one unique encrypted declaration and invocation to its reserved model step. */
function _SelectTool(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.ToolSelected)
		return _Reject(projection, event, budget);
	const current = projection.steps.at(-1);
	const selection = event.selection;
	if (current?.state !== ConversationComputerTurnProtocolStates.ModelReserved || current.reservation.tools !== ConversationModelToolModes.Select
		|| selection.ordinal !== current.reservation.ordinal || selection.modelInvocationFence !== current.reservation.invocationFence
		|| !_Reference(selection.declaration) || !_Identifier(selection.proposalId) || selection.toolInvocationId !== selection.proposalId || !_Digest(selection.requestFingerprint)
		|| projection.steps.some(step => step.selection?.proposalId === selection.proposalId || step.selection?.toolInvocationId === selection.toolInvocationId || step.selection?.declaration.payloadRef === selection.declaration.payloadRef)
		|| projection.accounting.reservedToolInvocations >= budget.maxToolInvocations
		|| projection.accounting.reservedModelCalls >= budget.maxModelTurns || projection.accounting.reservedCompletionTokens >= budget.maxCompletionTokens
		|| projection.accounting.toolResultCyclesFed >= budget.maxLoopIterations)
		throw new Error("Conversation computer tool selection crossed its reserved model step");
	const step: ConversationComputerTurnStep = { state: ConversationComputerTurnProtocolStates.ToolPending, reservation: current.reservation, selection, result: null };
	return { ...projection, state: ConversationComputerTurnProtocolStates.ToolPending, revision: projection.revision + 1n, steps: [...projection.steps.slice(0, -1), step], accounting: { ...projection.accounting, reservedToolInvocations: projection.accounting.reservedToolInvocations + 1 } };
}

/** Completes the selected invocation with one unique encrypted exchange reference. */
function _RecordToolResult(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, _budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.ToolResultRecorded)
		return _Reject(projection, event, _budget);
	const current = projection.steps.at(-1);
	const result = event.result;
	if (current?.state !== ConversationComputerTurnProtocolStates.ToolPending || result.ordinal !== current.reservation.ordinal
		|| result.proposalId !== current.selection.proposalId || result.toolInvocationId !== current.selection.toolInvocationId
		|| !_Digest(result.resultDigest) || !_Reference(result.exchange) || !_Positive(result.authorityExpiresAtEpochMs)
		|| projection.steps.slice(0, -1).some(step => step.result?.exchange.payloadRef === result.exchange.payloadRef)
		|| result.authorityExpiresAtEpochMs > current.reservation.authorityExpiresAtEpochMs)
		throw new Error("Conversation computer tool result crossed its selected invocation");
	const step: ConversationComputerTurnStep = { state: ConversationComputerTurnProtocolStates.ResultReady, reservation: current.reservation, selection: current.selection, result };
	return { ...projection, state: ConversationComputerTurnProtocolStates.ResultReady, revision: projection.revision + 1n, steps: [...projection.steps.slice(0, -1), step] };
}

/** Makes the current model fence the terminal participant-output authority. */
function _RecordOutput(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, _budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.OutputRecorded)
		return _Reject(projection, event, _budget);
	const current = projection.steps.at(-1);
	if (current?.state !== ConversationComputerTurnProtocolStates.ModelReserved || event.ordinal !== current.reservation.ordinal
		|| event.modelInvocationFence !== current.reservation.invocationFence || event.sourceCommandId !== current.reservation.invocationFence)
		throw new Error("Conversation computer output crossed its reserved model step");
	return { ...projection, state: ConversationComputerTurnProtocolStates.OutputRecorded, revision: projection.revision + 1n, output: { sourceCommandId: event.sourceCommandId, receipt: event.receipt } };
}

/** Records the closed reason tied to the current model, tool or allowance position. */
function _MarkUnavailable(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, _budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.ResponseUnavailable)
		return _Reject(projection, event, _budget);
	const current = projection.steps.at(-1);
	const receipt = event.receipt;
	if (!_Identifier(receipt.sourceCommandId) || receipt.ordinal !== (current?.reservation.ordinal ?? null))
		throw new Error("Conversation computer unavailable result crossed its current step");
	if (receipt.reason === ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable
		&& (current?.state !== ConversationComputerTurnProtocolStates.ModelReserved || receipt.sourceCommandId !== current.reservation.invocationFence))
		throw new Error("Conversation computer unavailable result crossed its model reservation");
	if (receipt.reason === ConversationComputerTurnUnavailableReasons.ToolResultUnavailable
		&& (current?.state !== ConversationComputerTurnProtocolStates.ToolPending || receipt.sourceCommandId !== current.selection.toolInvocationId))
		throw new Error("Conversation computer unavailable result crossed its tool selection");
	if (receipt.reason === ConversationComputerTurnUnavailableReasons.AllowanceExhausted
		&& projection.state !== ConversationComputerTurnProtocolStates.Open && projection.state !== ConversationComputerTurnProtocolStates.ResultReady)
		throw new Error("Conversation computer allowance ended from an invalid state");
	if (receipt.reason !== ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable && receipt.reason !== ConversationComputerTurnUnavailableReasons.ToolResultUnavailable && receipt.reason !== ConversationComputerTurnUnavailableReasons.AllowanceExhausted)
		throw new Error("Conversation computer unavailable result has an unknown reason");
	return { ...projection, state: ConversationComputerTurnProtocolStates.ResponseUnavailable, revision: projection.revision + 1n, unavailable: receipt };
}

/** Makes an authorized Stop receipt terminal without refunding consumed allowance. */
function _Cancel(projection: ConversationComputerTurnProtocolProjection, event: ConversationComputerTurnProtocolEvent, _budget: ConversationComputerTurnBudget): ConversationComputerTurnProtocolProjection
{
	if (event.kind !== ConversationComputerTurnProtocolEvents.Cancelled || !_Identifier(event.receipt.commandId) || !_Digest(event.receipt.commandDigest) || !Number.isFinite(Date.parse(event.receipt.occurredAt)))
		return _Reject(projection, event, _budget);
	return { ...projection, state: ConversationComputerTurnProtocolStates.Cancelled, revision: projection.revision + 1n, cancellation: event.receipt };
}

/** Rejects every event absent from the current state's accepted cells. */
function _Reject(_projection: ConversationComputerTurnProtocolProjection, _event: ConversationComputerTurnProtocolEvent, _budget: ConversationComputerTurnBudget): never
{
	throw new Error("Conversation computer turn event is invalid for its protocol state");
}

/** Rejects a malformed allowance before any event changes aggregate accounting. */
function _AssertBudget(budget: ConversationComputerTurnBudget): void
{
	if (!_Positive(budget.maxModelTurns) || !_Positive(budget.maxCompletionTokens) || !_Nonnegative(budget.maxToolInvocations) || !_Positive(budget.maxLoopIterations)
		|| !_Positive(budget.wallClockDeadlineEpochMs) || budget.maxCostUsdMicros !== null && !_Positive(budget.maxCostUsdMicros))
		throw new Error("Conversation computer turn budget is invalid");
}

/** Returns whether a value is a positive safe count or timestamp. */
function _Positive(value: number): boolean
{
	return Number.isSafeInteger(value) && value > 0;
}

/** Returns whether a value is a nonnegative safe count. */
function _Nonnegative(value: number): boolean
{
	return Number.isSafeInteger(value) && value >= 0;
}

/** Rejects empty durable identifiers and storage references. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0;
}

/** Recognizes the repository's canonical SHA-256 digest form. */
function _Digest(value: string): boolean
{
	return /^sha256:[0-9a-f]{64}$/u.test(value);
}

/** Validates the non-secret coordinates of encrypted model custody. */
function _Reference(value: { readonly payloadRef: string; readonly ciphertextDigest: string }): boolean
{
	return _Identifier(value.payloadRef) && _Digest(value.ciphertextDigest);
}
