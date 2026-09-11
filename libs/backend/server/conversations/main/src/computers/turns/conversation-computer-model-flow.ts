import { createHash, randomUUID } from "node:crypto";
import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ConversationModelResponseKinds, ConversationModelToolModes, ___ConversationModelContinuationSchema, ___ConversationToolProposalSchema, type ConversationModelToolCall } from "@opencrane/contracts";
import { ___CanonicalizeJson, ___DigestCanonicalJson, ___ParseAndValidateJson, type JsonValue } from "@opencrane/util";

import { _ConversationModelRequestDigest } from "./conversation-computer-model-reservation";
import type { ConversationComputerModelProgress, ConversationComputerModelReservation } from "./conversation-computer-model.types";
import { ConversationComputerToolResultOutcomes, type ConversationComputerContinuationReservation, type ConversationComputerPrivateModelReference, type ConversationComputerToolDeclaration } from "./conversation-computer-continuation.types";
import type { ConversationComputerCredentialReceipt, ConversationComputerOutputCommand, ConversationComputerTurnAuthorityDependencies, ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";
import { _PrepareConversationToolProposal } from "../tools/proposal/conversation-tool-proposal";
import { ConversationToolResultNotificationOutcomes } from "./tool-result-notifications/conversation-tool-result-notification.types";

/**
 * Advances one text answer or one tool followed by a final answer within the original attempt.
 * Only fresh reservation winners send model requests. Saved declarations may finish tool admission
 * after a restart, but never grant permission to repeat a paid model request.
 * Called by: ConversationComputerTurnAuthority.advance after the workflow rechecks the current lease.
 */
export async function _AdvanceConversationComputerModel(turn: FrozenConversationComputerTurn, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	if (turn.continuationReservation !== null)
		return _ConversationModelReservationStatus(turn.continuationReservation);
	if (turn.modelReservation !== null)
	{
		const saved = await dependencies.modelCustody.loadDeclaration(turn);
		return saved === null ? _ConversationModelReservationStatus(turn.modelReservation) : _ContinueTool(turn, saved.declaration, saved.reference, dependencies, appendOutput);
	}
	const { candidate } = await _Current(turn, dependencies);
	const reservation = _FirstReservation(turn, candidate);
	if (!await dependencies.store.reserveModel(turn.bootstrapId, reservation))
		return _ConversationModelReservationStatus((await dependencies.store.load(turn.bootstrapId))?.modelReservation ?? reservation);
	const reserved = { ...turn, modelReservation: reservation };
	const credential = await dependencies.credentials.issueOnce(_CredentialCommand(reserved, candidate));
	const current = await _Current(reserved, dependencies);
	const notAfter = _RequestDeadline(reservation, current.candidate, credential);
	const response = await dependencies.model.request({ compiledInput: current.candidate.compiledInput, endpoint: dependencies.endpoint, key: credential.key, modelAlias: turn.modelAlias, maxCompletionTokens: reservation.maxCompletionTokens, notAfterEpochMs: notAfter, tools: reservation.tools, continuation: null });
	if (response.kind === ConversationModelResponseKinds.Text)
	{
		await appendOutput({ bootstrapId: turn.bootstrapId, sourceCommandId: reservation.invocationFence, modelInvocationFence: reservation.invocationFence, modelNotAfterEpochMs: notAfter, text: response.text });
		return { outcome: "completed" };
	}
	if (reservation.tools !== ConversationModelToolModes.Select || response.kind !== ConversationModelResponseKinds.Tool)
		throw new Error("Conversation model returned an unreserved tool declaration");
	const acceptedAtEpochMs = Date.now();
	if (acceptedAtEpochMs >= notAfter)
		throw new Error("Conversation model declaration missed its dispatch deadline");
	const accepted = await _Current(reserved, dependencies);
	_Proposal(reserved, accepted.candidate, response.call);
	const declaration = { bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, modelInvocationFence: reservation.invocationFence, acceptedAtEpochMs, requestNotAfterEpochMs: notAfter, credentialDigest: credential.credentialDigest, credentialExpiresAt: credential.expiresAt, call: response.call };
	const reference = await dependencies.modelCustody.storeDeclaration(reserved, declaration);
	return _ContinueTool(reserved, declaration, reference, dependencies, appendOutput);
}

/** Recover the saved tool declaration, its existing executor and one exact terminal result. */
async function _ContinueTool(turn: FrozenConversationComputerTurn, declaration: ConversationComputerToolDeclaration, reference: ConversationComputerPrivateModelReference, dependencies: ConversationComputerTurnAuthorityDependencies, appendOutput: (command: ConversationComputerOutputCommand) => Promise<unknown>): Promise<ConversationComputerModelProgress>
{
	const currentExecution = await _Current(turn, dependencies);
	const proposal = _Proposal(turn, currentExecution.candidate, declaration.call);
	const selection = { ...reference, proposalId: proposal.prepared.proposalId, requestFingerprint: proposal.prepared.requestFingerprint };
	await dependencies.store.selectTool(turn.bootstrapId, selection);
	const selected = (await dependencies.store.load(turn.bootstrapId))!;
	const workload = currentExecution.workload;
	await dependencies.toolProposals.admit(selected, currentExecution.candidate, proposal.command, { audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: workload.namespace, serviceAccountName: workload.serviceAccountName, workloadKind: "pod", workloadUid: workload.podUid, podUid: workload.podUid });
	const result = await dependencies.toolResults.read(selected, workload);
	if (result.outcome === ConversationComputerToolResultOutcomes.Pending)
		return { outcome: "tool_pending", toolInvocationId: selection.proposalId, waitFor: result.waitFor, waitUntilEpochMs: result.waitUntilEpochMs };
	if (result.outcome !== ConversationComputerToolResultOutcomes.Available)
		return { outcome: "authority_ended" };
	const pair = ___ConversationModelContinuationSchema.parse({ call: declaration.call, resultContent: ___CanonicalizeJson(result.payload) });
	if (___DigestCanonicalJson(result.payload) !== result.payloadDigest)
		throw new Error("Conversation tool result differs from its immutable digest");
	const continuation = { bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, declaration: reference, proposalId: selection.proposalId, resultDigest: result.payloadDigest, ...pair };
	const continuationReference = await dependencies.modelCustody.storeContinuation(selected, continuation);
	const notification = await dependencies.toolResultNotifications.publishTerminal({ bootstrapId: selected.bootstrapId, siloId: selected.siloId, conversationId: selected.binding.conversationId, runId: selected.compile.runId, attempt: selected.compile.attempt, toolInvocationId: selection.proposalId, expectedResultDigest: result.payloadDigest });
	if (notification !== ConversationToolResultNotificationOutcomes.Published)
		return { outcome: "authority_ended" };
	const current = await _Current(selected, dependencies);
	const reservation = _SecondReservation(selected, current.candidate, declaration, continuationReference, result.payloadDigest, result.notAfterEpochMs);
	if (!await dependencies.store.reserveContinuation(turn.bootstrapId, reservation))
		return _ConversationModelReservationStatus((await dependencies.store.load(turn.bootstrapId))?.continuationReservation ?? reservation);
	const reserved = (await dependencies.store.load(turn.bootstrapId))!;
	const consumed = await dependencies.toolResults.consume(reserved, workload);
	if (consumed.outcome !== ConversationComputerToolResultOutcomes.Available || consumed.payloadDigest !== reservation.resultDigest)
		throw new Error("Conversation tool result could not acknowledge its saved continuation");
	const saved = await dependencies.modelCustody.loadContinuation(reserved, reservation.continuation);
	if (saved.resultContent !== ___CanonicalizeJson(consumed.payload) || ___CanonicalizeJson(saved.call as unknown as JsonValue) !== ___CanonicalizeJson(declaration.call as unknown as JsonValue))
		throw new Error("Conversation continuation differs from its accepted call and exact result");
	const credential = await dependencies.credentials.reuseExact({ ..._CredentialCommand(reserved, current.candidate), expectedCredentialDigest: declaration.credentialDigest, expectedExpiresAt: declaration.credentialExpiresAt });
	const dispatch = await _Current(reserved, dependencies);
	const notAfter = Math.min(_RequestDeadline(reservation, dispatch.candidate, credential), consumed.notAfterEpochMs);
	if (Date.now() >= notAfter)
		throw new Error("Conversation continuation authority expired before dispatch");
	const response = await dependencies.model.request({ compiledInput: dispatch.candidate.compiledInput, endpoint: dependencies.endpoint, key: credential.key, modelAlias: turn.modelAlias, maxCompletionTokens: reservation.maxCompletionTokens, notAfterEpochMs: notAfter, tools: ConversationModelToolModes.None, continuation: { call: saved.call, resultContent: saved.resultContent } });
	if (response.kind !== ConversationModelResponseKinds.Text)
		throw new Error("Conversation continuation cannot request another tool");
	await appendOutput({ bootstrapId: turn.bootstrapId, sourceCommandId: reservation.invocationFence, modelInvocationFence: reservation.invocationFence, modelNotAfterEpochMs: notAfter, text: response.text });
	return { outcome: "completed" };
}

/** Select one unambiguous frozen definition, then reuse the existing schema and budget validator. */
function _Proposal(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, call: ConversationModelToolCall)
{
	const matching = candidate.compiledInput.tools.filter(tool => tool.name === call.name);
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
	if (input.digest !== turn.compile.digest || input.runId !== turn.compile.runId || input.attempt !== turn.compile.attempt || input.promptCompilerVersion !== turn.compile.promptCompilerVersion)
		throw new Error("Conversation model input differs from its frozen attempt");
	return execution;
}

/** Conservatively reserve a first-call share; provider usage never replenishes that share. */
function _FirstReservation(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate): ConversationComputerModelReservation
{
	const input = candidate.compiledInput;
	const ceilings = [input.budget.maxCompletionTokens, input.model.maxOutputTokens];
	const limits = ceilings.filter((value): value is number => value !== null && Number.isSafeInteger(value) && value > 0);
	const authorityExpiresAtEpochMs = Math.min(input.budget.wallClockDeadlineEpochMs ?? Number.POSITIVE_INFINITY, Date.parse(candidate.credentialExpiresAt));
	if (ceilings.some(value => value !== null && (!Number.isSafeInteger(value) || value <= 0)) || input.budget.maxModelTurns === null || !Number.isSafeInteger(input.budget.maxModelTurns) || input.budget.maxModelTurns < 1 || limits.length === 0 || !Number.isSafeInteger(authorityExpiresAtEpochMs) || authorityExpiresAtEpochMs <= Date.now())
		throw new Error("Conversation model request has no remaining frozen allowance");
	const total = input.budget.maxCompletionTokens ?? Math.min(...limits) * 2;
	const maySelect = input.budget.maxModelTurns >= 2 && total >= 2 && Number.isSafeInteger(total) && (input.budget.maxToolInvocations === null || Number.isSafeInteger(input.budget.maxToolInvocations) && input.budget.maxToolInvocations >= 1) && input.tools.length > 0;
	const tools = maySelect ? ConversationModelToolModes.Select : ConversationModelToolModes.None;
	const maxCompletionTokens = maySelect ? Math.min(...limits, Math.floor(total / 2)) : Math.min(...limits);
	const facts = { ordinal: 1 as const, tools, compiledInputDigest: turn.compile.digest, maxCompletionTokens, authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: Math.min(authorityExpiresAtEpochMs, Date.now() + 25_000) };
	return { invocationFence: randomUUID(), ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

/** Call two uses only the unspent reserved-token remainder and the original absolute authority. */
function _SecondReservation(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, declaration: ConversationComputerToolDeclaration, continuation: ConversationComputerPrivateModelReference, resultDigest: string, resultNotAfter: number): ConversationComputerContinuationReservation
{
	const first = turn.modelReservation;
	const budget = candidate.compiledInput.budget;
	const route = candidate.compiledInput.model.maxOutputTokens;
	if (first === null || first.tools !== ConversationModelToolModes.Select || turn.toolSelection === null || budget.maxModelTurns === null || budget.maxModelTurns < 2)
		throw new Error("Conversation continuation was not reserved by the original attempt");
	const remaining = (budget.maxCompletionTokens ?? (route ?? 0) * 2) - first.maxCompletionTokens;
	const maxCompletionTokens = Math.min(remaining, route ?? remaining);
	const authorityExpiresAtEpochMs = Math.min(first.authorityExpiresAtEpochMs, budget.wallClockDeadlineEpochMs ?? first.authorityExpiresAtEpochMs, Date.parse(candidate.credentialExpiresAt), Date.parse(declaration.credentialExpiresAt), resultNotAfter);
	if (!Number.isSafeInteger(maxCompletionTokens) || maxCompletionTokens < 1 || !Number.isSafeInteger(authorityExpiresAtEpochMs) || authorityExpiresAtEpochMs <= Date.now())
		throw new Error("Conversation continuation has no original allowance remaining");
	const facts = { ordinal: 2 as const, tools: ConversationModelToolModes.None, compiledInputDigest: turn.compile.digest, maxCompletionTokens, authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: Math.min(authorityExpiresAtEpochMs, Date.now() + 25_000), continuation, proposalId: turn.toolSelection.proposalId, resultDigest };
	return { invocationFence: randomUUID(), ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

/** Keep the attempt key's fixed budget and lifetime separate from each shorter HTTP deadline. */
function _CredentialCommand(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate)
{
	if (turn.modelReservation === null)
		throw new Error("Conversation credential requires a saved first reservation");
	const budget = candidate.compiledInput.budget.maxCostUsdMicros;
	return { bootstrapId: turn.bootstrapId, computer: { siloId: turn.siloId, conversationId: turn.binding.conversationId, computerId: turn.computerId, agentIdentityId: turn.binding.agentIdentityId }, lease: turn.lease, keyAlias: `attempt-${createHash("sha256").update(turn.bootstrapId).digest("hex").slice(0, 40)}`, modelAlias: turn.modelAlias, maxBudgetUsd: budget === null ? turn.maximumBudgetUsd : Math.min(turn.maximumBudgetUsd, budget / 1_000_000), expirySeconds: Math.min(turn.credentialLifetimeSeconds, candidate.credentialLifetimeSeconds), notAfter: new Date(turn.modelReservation.authorityExpiresAtEpochMs).toISOString() };
}

/** Narrow response acceptance to every current bound without renewing a saved request. */
function _RequestDeadline(reservation: ConversationComputerModelReservation | ConversationComputerContinuationReservation, candidate: ConversationComputerTurnCandidate, credential: ConversationComputerCredentialReceipt)
{
	const notAfter = Math.min(reservation.dispatchDeadlineEpochMs, Date.parse(candidate.credentialExpiresAt), Date.parse(credential.expiresAt));
	if (!Number.isSafeInteger(notAfter) || Date.now() >= notAfter)
		throw new Error("Conversation model request authority expired before dispatch");
	return notAfter;
}

/** Reading an unconfirmed reservation reports status and never reacquires its paid dispatch. */
export function _ConversationModelReservationStatus(reservation: ConversationComputerModelReservation | ConversationComputerContinuationReservation): ConversationComputerModelProgress
{
	return Date.now() < reservation.dispatchDeadlineEpochMs
		? { outcome: "model_pending", notBeforeEpochMs: reservation.dispatchDeadlineEpochMs, ordinal: reservation.ordinal }
		: { outcome: "response_unavailable" };
}
