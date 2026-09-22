import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ConversationModelResponseKinds, ConversationModelToolModes, ___ConversationModelToolExchangeSchema, ___ConversationToolProposalSchema, ___ParseRunBudgetPolicy, type ConversationModelDelivery, type ConversationModelToolCall } from "@opencrane/contracts";
import { ___DigestCanonicalJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";

import { _ConversationToolResultContent } from "./conversation-tool-result-content";
import { _ConversationComputerTurnHistoryDigest } from "./conversation-computer-turn-protocol";
import { _ConversationModelRequestDigest } from "./conversation-computer-model-reservation";
import { ConversationComputerTurnProtocolStates } from "./conversation-computer-turn-protocol.types";
import { ConversationComputerModelProgressOutcomes, type ConversationComputerModelProgress } from "./conversation-computer-model.types";
import { ConversationComputerToolResultOutcomes, type ConversationComputerToolDeclaration, type ConversationComputerToolExchange } from "./conversation-computer-continuation.types";
import type { ConversationComputerPrivateModelReference, ConversationComputerTurnModelReservation, ConversationComputerTurnStep, ConversationComputerTurnToolSelection } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerCredentialReceipt, ConversationComputerOutputCommand, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import { _PrepareConversationToolProposal } from "../tools/proposal/conversation-tool-proposal";
import { ConversationToolResultNotificationOutcomes } from "./tool-result-notifications/conversation-tool-result-notification.types";
import { ConversationToolProgressNotificationOutcomes } from "./tool-progress-notifications/conversation-tool-progress-notification.types";
import { ConversationToolProposalRefusal } from "../tools/proposal/conversation-tool-proposal-refusal";
import { _CONVERSATION_MODEL_MAX_RETRIES, _ConversationModelInitialNonce, _ConversationModelLogicalFence } from "./conversation-computer-model-retry";
import type { ConversationComputerModelRetryClaim } from "./conversation-computer-model-retry.types";

/**
 * Advances bounded model/tool cycles and a final text answer within the original attempt.
 * Only fresh reservation winners send model requests. Saved declarations may finish tool admission
 * after a restart, but never grant permission to repeat a paid model request.
 * Called by: ConversationComputerTurnAuthority.advance after the workflow rechecks the current lease.
 */
export async function _AdvanceConversationComputerModel(turn: FrozenConversationComputerTurn, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	const step = turn.protocol.steps.at(-1);
	if (turn.protocol.state === ConversationComputerTurnProtocolStates.ModelRetryWaiting)
		return _continueModelRetry(turn, dependencies, appendOutput);
	if (turn.protocol.state === ConversationComputerTurnProtocolStates.ModelReserved && step !== undefined)
	{
		const saved = await dependencies.modelCustody.loadDeclaration(turn);
		return saved === null ? _ConversationModelReservationStatus(step.reservation) : _ContinueTool(turn, saved.declaration, saved.reference, dependencies, appendOutput);
	}
	if (turn.protocol.state === ConversationComputerTurnProtocolStates.ToolPending && step !== undefined)
	{
		const saved = await dependencies.modelCustody.loadDeclaration(turn);
		if (saved === null)
			throw new Error("Conversation model tool declaration custody is missing");
		return _ContinueTool(turn, saved.declaration, saved.reference, dependencies, appendOutput);
	}
	if (turn.protocol.state === ConversationComputerTurnProtocolStates.ResultReady && step?.state === ConversationComputerTurnProtocolStates.ResultReady)
		return _ContinueResultReady(turn, step, dependencies, appendOutput);
	if (turn.protocol.state !== ConversationComputerTurnProtocolStates.Open)
		return { outcome: ConversationComputerModelProgressOutcomes.AuthorityEnded };
	const { candidate } = await _Current(turn, dependencies);
	const reservation = _NextReservation(turn, candidate, _ConversationComputerTurnHistoryDigest(turn.protocol.steps));
	if (reservation === null)
		return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
	if (!await dependencies.store.reserveModel(turn.bootstrapId, reservation))
		return _ConversationModelReservationStatus((await dependencies.store.load(turn.bootstrapId))?.protocol.steps.at(-1)?.reservation ?? reservation);
	const reserved = (await dependencies.store.load(turn.bootstrapId))!;
	const credential = await dependencies.credentials.issueOnce(_CredentialCommand(reserved, candidate));
	return _DispatchReservedModel(reserved, reservation, credential, dependencies, appendOutput);
}

/** Recover a saved result step, reserve its one next model call and acknowledge the source result. */
async function _ContinueResultReady(turn: FrozenConversationComputerTurn, step: Extract<ConversationComputerTurnStep, { state: ConversationComputerTurnProtocolStates.ResultReady }>, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	const current = await _Current(turn, dependencies);
	const saved = await dependencies.modelCustody.loadDeclaration(turn, step.reservation.ordinal);
	const firstDeclaration = await dependencies.modelCustody.loadDeclaration(turn, 1);
	if (saved === null || firstDeclaration === null)
		throw new Error("Conversation model declaration custody is missing for a saved result");
	const reservation = _NextReservation(turn, current.candidate, _ConversationComputerTurnHistoryDigest(turn.protocol.steps), step.result.authorityExpiresAtEpochMs);
	if (reservation === null)
		return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
	if (!await dependencies.store.reserveModel(turn.bootstrapId, reservation))
		return _ConversationModelReservationStatus((await dependencies.store.load(turn.bootstrapId))?.protocol.steps.at(-1)?.reservation ?? reservation);
	const reserved = (await dependencies.store.load(turn.bootstrapId))!;
	const consumed = await dependencies.toolResults.consume(reserved, current.workload);
	if (consumed.outcome !== ConversationComputerToolResultOutcomes.Available || consumed.payloadDigest !== step.result.resultDigest)
		throw new Error("Conversation tool result could not acknowledge its saved exchange");
	const savedExchange = await dependencies.modelCustody.loadExchange(reserved, step.result.exchange);
	if (savedExchange.resultContent !== _ConversationToolResultContent(consumed) || ___DigestCanonicalJson(savedExchange.call as unknown as JsonValue) !== ___DigestCanonicalJson(saved.declaration.call as unknown as JsonValue))
		throw new Error("Conversation model exchange differs from its acknowledged tool result");
	const credential = await dependencies.credentials.reuseExact({ ..._CredentialCommand(reserved, current.candidate), expectedCredentialDigest: firstDeclaration.declaration.credentialDigest, expectedExpiresAt: firstDeclaration.declaration.credentialExpiresAt });
	return _DispatchReservedModel(reserved, reservation, credential, dependencies, appendOutput);
}

/** Dispatch one already reserved request and persist either its final text or its private tool declaration. */
async function _DispatchReservedModel(turn: FrozenConversationComputerTurn, reservation: ConversationComputerTurnModelReservation, credential: ConversationComputerCredentialReceipt, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>, delivery: ConversationModelDelivery = { physicalNonce: _ConversationModelInitialNonce(reservation), logicalFence: _ConversationModelLogicalFence(reservation) }): Promise<ConversationComputerModelProgress>
{
	const history = await _LoadHistory(turn, dependencies);
	const current = await _Current(turn, dependencies);
	const saved = await dependencies.store.load(turn.bootstrapId);
	if (saved === null || saved.protocol.state !== ConversationComputerTurnProtocolStates.ModelReserved
		|| saved.protocol.steps.at(-1)?.reservation.invocationFence !== reservation.invocationFence
		|| (saved.protocol.modelRetry?.claim?.physicalNonce ?? _ConversationModelInitialNonce(reservation)) !== delivery.physicalNonce)
		return { outcome: ConversationComputerModelProgressOutcomes.Retry };
	const notAfter = _RequestDeadline(reservation, current.candidate, credential);
	const response = await dependencies.model.request({ compiledInput: current.candidate.compiledInput, endpoint: dependencies.endpoint, key: credential.key, modelAlias: turn.modelAlias, maxCompletionTokens: reservation.maxCompletionTokens, notAfterEpochMs: notAfter, tools: reservation.tools, history, delivery });
	if (response.kind === ConversationModelResponseKinds.PreForwardRejected)
	{
		const receivedAtEpochMs = Date.now();
		await _Current(turn, dependencies);
		await dependencies.store.recordModelRejection(turn.bootstrapId, { receipt: response.receipt, credentialDigest: credential.credentialDigest, credentialExpiresAt: credential.expiresAt, receivedAtEpochMs });
		const rejected = await dependencies.store.load(turn.bootstrapId);
		return rejected === null ? { outcome: ConversationComputerModelProgressOutcomes.Retry } : _ConversationModelRetryStatus(rejected);
	}
	if (response.kind === ConversationModelResponseKinds.Text)
	{
		await appendOutput({ bootstrapId: turn.bootstrapId, sourceCommandId: reservation.invocationFence, modelInvocationFence: reservation.invocationFence, modelNotAfterEpochMs: notAfter, text: response.text, ...(response.display === undefined ? {} : { display: response.display }) });
		return { outcome: ConversationComputerModelProgressOutcomes.Completed };
	}
	if (reservation.tools !== ConversationModelToolModes.Select || response.kind !== ConversationModelResponseKinds.Tool)
		throw new Error("Conversation model returned an unreserved tool declaration");
	if (history.some(exchange => exchange.call.id === response.call.id))
		throw new Error("Conversation model reused a provider tool call id");
	const acceptedAtEpochMs = Date.now();
	if (acceptedAtEpochMs >= notAfter)
		throw new Error("Conversation model declaration missed its dispatch deadline");
	const accepted = await _Current(turn, dependencies);
	_Proposal(turn, accepted.candidate, response.call);
	const declaration: ConversationComputerToolDeclaration = { bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, ordinal: reservation.ordinal, modelInvocationFence: reservation.invocationFence, acceptedAtEpochMs, requestNotAfterEpochMs: notAfter, credentialDigest: credential.credentialDigest, credentialExpiresAt: credential.expiresAt, call: response.call };
	const reference = await dependencies.modelCustody.storeDeclaration(turn, declaration);
	return _ContinueTool(turn, declaration, reference, dependencies, appendOutput);
}

/**
 * Claims a physical retry only after saved proof permits it and the original credential is usable.
 * Reading another worker's claim, or losing the acknowledgement for our own, never dispatches.
 * The final send repeats the current-authority and saved-claim checks after these awaited operations.
 */
async function _continueModelRetry(turn: FrozenConversationComputerTurn, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	const status = _ConversationModelRetryStatus(turn);
	if (status.outcome !== ConversationComputerModelProgressOutcomes.Retry)
		return status;
	const retry = turn.protocol.modelRetry!;
	const rejection = retry.rejections.at(-1)!;
	const reservation = turn.protocol.steps.at(-1)!.reservation;
	const current = await _Current(turn, dependencies);
	const credential = await dependencies.credentials.reuseExact({ ..._CredentialCommand(turn, current.candidate), expectedCredentialDigest: rejection.credentialDigest, expectedExpiresAt: rejection.credentialExpiresAt });
	if (credential.credentialDigest !== rejection.credentialDigest || credential.expiresAt !== rejection.credentialExpiresAt)
		throw new Error("Conversation model retry credential differs from its saved rejection");
	if (_RequestDeadline(reservation, current.candidate, credential) !== rejection.receipt.deadlineEpochMs)
		return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
	const claim: ConversationComputerModelRetryClaim = { ordinal: reservation.ordinal, modelInvocationFence: reservation.invocationFence, retryOrdinal: retry.rejections.length, physicalNonce: randomBytes(32).toString("hex"), claimedAtEpochMs: Date.now() };
	if (!await dependencies.store.claimModelRetry(turn.bootstrapId, claim))
		return { outcome: ConversationComputerModelProgressOutcomes.Retry };
	const claimed = await dependencies.store.load(turn.bootstrapId);
	if (claimed === null)
		return { outcome: ConversationComputerModelProgressOutcomes.Retry };
	return _DispatchReservedModel(claimed, reservation, credential, dependencies, appendOutput, { physicalNonce: claim.physicalNonce, logicalFence: rejection.receipt.logicalFence, expectedRequestBodySha256: rejection.receipt.requestBodySha256 });
}

/** Reports a saved wait or exhausted retry without granting physical dispatch. */
export function _ConversationModelRetryStatus(turn: FrozenConversationComputerTurn): ConversationComputerModelProgress
{
	if (turn.protocol.state !== ConversationComputerTurnProtocolStates.ModelRetryWaiting)
		return { outcome: ConversationComputerModelProgressOutcomes.Retry };
	const retry = turn.protocol.modelRetry;
	const rejection = retry?.rejections.at(-1);
	const reservation = turn.protocol.steps.at(-1)?.reservation;
	if (retry === null || rejection === undefined || reservation === undefined)
		throw new Error("Conversation model retry wait lacks its saved rejection");
	if (Date.now() >= rejection.receipt.deadlineEpochMs || retry.rejections.length > _CONVERSATION_MODEL_MAX_RETRIES)
		return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
	if (Date.now() >= rejection.receipt.retryAtEpochMs)
		return { outcome: ConversationComputerModelProgressOutcomes.Retry };
	return { outcome: ConversationComputerModelProgressOutcomes.ModelRetryWaiting, notBeforeEpochMs: rejection.receipt.retryAtEpochMs, ordinal: reservation.ordinal, retryOrdinal: retry.rejections.length };
}

/** Recover the saved tool declaration, its existing executor and one exact terminal result. */
async function _ContinueTool(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration, reference: ConversationComputerPrivateModelReference, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	const currentExecution = await _Current(turn, dependencies);
	let proposal;
	try
	{
		proposal = _Proposal(turn, currentExecution.candidate, declaration.call);
	}
	catch (error)
	{
		if (error instanceof ConversationToolProposalRefusal)
			return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
		throw error;
	}
	const currentStep = turn.protocol.steps.at(-1);
	let selection: ConversationComputerTurnToolSelection;
	if (currentStep?.state === ConversationComputerTurnProtocolStates.ToolPending)
		selection = currentStep.selection;
	else
	{
		if (currentStep?.state !== ConversationComputerTurnProtocolStates.ModelReserved)
			throw new Error("Conversation model tool declaration is not at an open model step");
		selection = { ordinal: declaration.ordinal, modelInvocationFence: declaration.modelInvocationFence, declaration: reference, proposalId: proposal.prepared.proposalId, toolInvocationId: proposal.prepared.proposalId, requestFingerprint: proposal.prepared.requestFingerprint };
		await dependencies.store.selectTool(turn.bootstrapId, selection);
	}
	const selected = (await dependencies.store.load(turn.bootstrapId))!;
	const workload = currentExecution.workload;
	let admitted;
	try
	{
		admitted = await dependencies.toolProposals.admit(selected, currentExecution.candidate, proposal.command, { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: workload.namespace, serviceAccountName: workload.serviceAccountName, workloadKind: "pod", workloadUid: workload.podUid, podUid: workload.podUid });
	}
	catch (error)
	{
		if (error instanceof ConversationToolProposalRefusal)
			return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
		throw error;
	}
	if (admitted.proposalId !== selection.proposalId)
		throw new Error("Conversation tool admission returned a different proposal");
	const requested = await dependencies.toolRequestedNotifications.publishRequested({ bootstrapId: selected.bootstrapId, siloId: selected.siloId, conversationId: selected.binding.conversationId, runId: selected.compile.runId, attempt: selected.compile.attempt, toolInvocationId: selection.toolInvocationId });
	if (requested !== ConversationToolProgressNotificationOutcomes.Published)
		return { outcome: ConversationComputerModelProgressOutcomes.AuthorityEnded };
	const result = await dependencies.toolResults.read(selected, workload);
	if (result.outcome === ConversationComputerToolResultOutcomes.GeneratedFilePending)
		return { outcome: ConversationComputerToolResultOutcomes.GeneratedFilePending, operationId: result.operationId, notAfterEpochMs: result.notAfterEpochMs };
	if (result.outcome === ConversationComputerToolResultOutcomes.Pending)
		return { outcome: ConversationComputerModelProgressOutcomes.ToolPending, toolInvocationId: selection.toolInvocationId, waitFor: result.waitFor, waitUntilEpochMs: result.waitUntilEpochMs };
	if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
		return { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
	if (___DigestCanonicalJson(result.payload) !== result.payloadDigest)
		throw new Error("Conversation tool result differs from its immutable digest");
	const pair = ___ConversationModelToolExchangeSchema.parse({ call: declaration.call, resultContent: _ConversationToolResultContent(result) });
	const exchange: ConversationComputerToolExchange = { bootstrapId: selected.bootstrapId, runId: selected.compile.runId, attempt: selected.compile.attempt, compiledInputDigest: selected.compile.digest, ordinal: selection.ordinal, modelInvocationFence: selection.modelInvocationFence, declaration: reference, proposalId: selection.proposalId, toolInvocationId: selection.toolInvocationId, resultDigest: result.payloadDigest, ...pair };
	await _Current(selected, dependencies);
	const exchangeReference = await dependencies.modelCustody.storeExchange(selected, exchange);
	await _Current(selected, dependencies);
	const notification = await dependencies.toolResultNotifications.publishTerminal({ bootstrapId: selected.bootstrapId, siloId: selected.siloId, conversationId: selected.binding.conversationId, runId: selected.compile.runId, attempt: selected.compile.attempt, toolInvocationId: selection.toolInvocationId, expectedResultDigest: result.payloadDigest });
	if (notification !== ConversationToolResultNotificationOutcomes.Published)
		return { outcome: ConversationComputerModelProgressOutcomes.AuthorityEnded };
	await _Current(selected, dependencies);
	const selectedAuthorityExpiresAtEpochMs = selected.protocol.steps.at(-1)?.reservation.authorityExpiresAtEpochMs ?? selected.budget.wallClockDeadlineEpochMs;
	await dependencies.store.recordToolResult(selected.bootstrapId, { ordinal: selection.ordinal, proposalId: selection.proposalId, toolInvocationId: selection.toolInvocationId, resultDigest: result.payloadDigest, exchange: exchangeReference, authorityExpiresAtEpochMs: Math.min(result.notAfterEpochMs, selectedAuthorityExpiresAtEpochMs, Date.parse(declaration.credentialExpiresAt), selected.budget.wallClockDeadlineEpochMs) });
	const ready = await dependencies.store.load(selected.bootstrapId);
	const readyStep = ready?.protocol.steps.at(-1);
	if (ready === null || readyStep?.state !== ConversationComputerTurnProtocolStates.ResultReady)
		throw new Error("Conversation tool result did not reach its ordered ready state");
	return _ContinueResultReady(ready, readyStep, dependencies, appendOutput);
}

/**
 * Resolve the model's wire name to one frozen revision before proposal validation.
 * The original MCP name stays in the definition for disclosure and runtime dispatch.
 */
function _Proposal(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, call: ConversationModelToolCall)
{
	const matching = candidate.compiledInput.tools.filter(tool => tool.modelName === call.name);
	if (matching.length !== 1)
		throw new Error("Conversation model selected an unavailable or ambiguous tool");
	const command = ___ParseAndValidateJson(call.arguments, "Conversation tool arguments", argumentsValue => ___ConversationToolProposalSchema.parse({ bootstrapId: turn.bootstrapId, toolRevisionId: matching[0]!.toolRevisionId, arguments: argumentsValue }));
	return { command, prepared: _PrepareConversationToolProposal(turn, candidate, command) };
}

/** Recompile without changing the original history revision, run attempt or digest. */
async function _Current(turn: FrozenConversationComputerTurn, dependencies: ConversationComputerTurnAuthorityDependencies)
{
	const execution = await dependencies.candidates.assertCurrentForWorkflow(turn);
	const candidate = execution.candidate;
	const input = candidate.compiledInput;
	if (input.digest !== turn.compile.digest || input.runId !== turn.compile.runId || input.attempt !== turn.compile.attempt || input.promptCompilerVersion !== turn.compile.promptCompilerVersion
		|| ___DigestCanonicalJson(___ParseRunBudgetPolicy(input.budget) as unknown as JsonValue) !== ___DigestCanonicalJson(turn.budget as unknown as JsonValue))
		throw new Error("Conversation model input differs from its frozen attempt");
	return execution;
}

/** Load every saved assistant/tool pair in its durable ordinal order for one model request. */
async function _LoadHistory(turn: FrozenConversationComputerTurn, dependencies: ConversationComputerTurnAuthorityDependencies)
{
	const exchanges = [];
	for (const step of turn.protocol.steps)
	{
		if (step.result === null)
			continue;
		const exchange = await dependencies.modelCustody.loadExchange(turn, step.result.exchange);
		exchanges.push(___ConversationModelToolExchangeSchema.parse({ call: exchange.call, resultContent: exchange.resultContent }));
	}
	return exchanges;
}

/** Reserve the next ordered model call from aggregate allowances without refunding prior calls. */
function _NextReservation(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, historyDigest: string, resultNotAfter?: number): ConversationComputerTurnModelReservation | null
{
	const input = candidate.compiledInput;
	const accounting = turn.protocol.accounting;
	const remainingCalls = input.budget.maxModelTurns - accounting.reservedModelCalls;
	const remainingTokens = input.budget.maxCompletionTokens - accounting.reservedCompletionTokens;
	const routeLimit = input.model.maxOutputTokens;
	if (routeLimit !== null && (!Number.isSafeInteger(routeLimit) || routeLimit < 1))
		throw new Error("Conversation model route token limit is invalid");
	const limits = [remainingTokens, routeLimit].filter((value): value is number => value !== null && Number.isSafeInteger(value) && value > 0);
	const cyclesAfterReservation = accounting.toolResultCyclesFed + (turn.protocol.state === ConversationComputerTurnProtocolStates.ResultReady ? 1 : 0);
	const maySelect = remainingCalls > 1 && remainingTokens > 1 && accounting.reservedToolInvocations < input.budget.maxToolInvocations && cyclesAfterReservation < input.budget.maxLoopIterations && input.tools.length > 0;
	const maxCompletionTokens = maySelect ? Math.min(...limits, Math.floor(remainingTokens / 2)) : Math.min(...limits);
	const previousAuthorityExpiresAtEpochMs = turn.protocol.steps.at(-1)?.reservation.authorityExpiresAtEpochMs ?? turn.budget.wallClockDeadlineEpochMs;
	const authorityExpiresAtEpochMs = Math.min(previousAuthorityExpiresAtEpochMs, turn.budget.wallClockDeadlineEpochMs, Date.parse(candidate.credentialExpiresAt), resultNotAfter ?? Number.MAX_SAFE_INTEGER);
	if (remainingCalls < 1 || remainingTokens < 1 || limits.length === 0 || !Number.isSafeInteger(maxCompletionTokens) || maxCompletionTokens < 1 || !Number.isSafeInteger(authorityExpiresAtEpochMs) || authorityExpiresAtEpochMs <= Date.now())
		return null;
	const tools = maySelect ? ConversationModelToolModes.Select : ConversationModelToolModes.None;
	const ordinal = accounting.reservedModelCalls + 1;
	const facts = { ordinal, tools, compiledInputDigest: turn.compile.digest, historyDigest, maxCompletionTokens, authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: Math.min(authorityExpiresAtEpochMs, Date.now() + 25_000) };
	return { invocationFence: randomUUID(), ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

/** Keep the attempt key's fixed budget and lifetime separate from each shorter HTTP deadline. */
function _CredentialCommand(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate)
{
	const budget = candidate.compiledInput.budget.maxCostUsdMicros;
	const firstReservation = turn.protocol.steps[0]?.reservation;
	const authorityExpiresAtEpochMs = Math.min(firstReservation?.authorityExpiresAtEpochMs ?? turn.budget.wallClockDeadlineEpochMs, Date.parse(candidate.credentialExpiresAt));
	return { bootstrapId: turn.bootstrapId, computer: { siloId: turn.siloId, conversationId: turn.binding.conversationId, computerId: turn.computerId, agentIdentityId: turn.binding.agentIdentityId }, lease: turn.lease, keyAlias: `attempt-${createHash("sha256").update(turn.bootstrapId).digest("hex").slice(0, 40)}`, modelAlias: turn.modelAlias, maxBudgetUsd: budget === null ? turn.maximumBudgetUsd : Math.min(turn.maximumBudgetUsd, budget / 1_000_000), expirySeconds: Math.min(turn.credentialLifetimeSeconds, candidate.credentialLifetimeSeconds), notAfter: new Date(authorityExpiresAtEpochMs).toISOString() };
}

/** Narrow response acceptance to every current bound without renewing a saved request. */
function _RequestDeadline(reservation: ConversationComputerTurnModelReservation, candidate: ConversationComputerTurnCandidate, credential: ConversationComputerCredentialReceipt)
{
	const notAfter = Math.min(reservation.dispatchDeadlineEpochMs, Date.parse(candidate.credentialExpiresAt), Date.parse(credential.expiresAt));
	if (!Number.isSafeInteger(notAfter) || Date.now() >= notAfter)
		throw new Error("Conversation model request authority expired before dispatch");
	return notAfter;
}

/** Reading an unconfirmed reservation reports status and never reacquires its paid dispatch. */
export function _ConversationModelReservationStatus(reservation: ConversationComputerTurnModelReservation): ConversationComputerModelProgress
{
	return Date.now() < reservation.dispatchDeadlineEpochMs
		? { outcome: ConversationComputerModelProgressOutcomes.ModelPending, notBeforeEpochMs: reservation.dispatchDeadlineEpochMs, ordinal: reservation.ordinal }
		: { outcome: ConversationComputerModelProgressOutcomes.ResponseUnavailable };
}
