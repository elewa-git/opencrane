import { AgentRunState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, ElicitationResponseAttemptState, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideDeferredToolRequest, __DigestCanonicalJson, __ExpireDeferredToolApprovalBatch, DeferredToolDecisionKinds } from "@opencrane/backend/server/iam/authorization";
import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationBody, type ElicitationResponseValue } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _ElicitationStateForResponse, _IsElicitationResponseValid } from "./elicitation-response.js";
import type { ElicitationRepository, ElicitationUnitOfWork, OpenElicitationCommand, RespondToElicitationCommand, RespondToElicitationResult } from "./elicitation.types.js";

/** Prisma repository bound to exactly one serializable elicitation transaction. */
class PrismaElicitationRepository implements ElicitationRepository
{
	/** Exact transaction used by every read and write. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Bind all request, response, purpose, and resume operations to one transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Pause the exact run and create or replay one request. */
	async open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		const transaction = this._transaction;
		const bodyDigest = __DigestCanonicalJson(command.body as unknown as JsonValue);
		const existing = await transaction.elicitationRequest.findUnique({ where: { runId_attempt_requestKey: { runId: command.runId, attempt: command.attempt, requestKey: command.requestKey } } });
		if (existing !== null) return existing.id === command.requestId && existing.bodyDigest === bodyDigest && existing.purposePayloadDigest === command.purposePayloadDigest ? _Projection(existing) : null;
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
		const participant = await transaction.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: command.conversationId, userId: command.assignedParticipantId } } });
		if (run === null || run.siloId !== command.siloId || run.conversationId !== command.conversationId || run.attempt !== command.attempt || participant === null || participant.accessEndedPosition !== null || command.expiresAt.getTime() <= command.now.getTime()) return null;
		if (run.state === AgentRunState.Running)
		{
			const paused = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
			if (paused.count !== 1) return null;
		}
		else if (run.state !== AgentRunState.WaitingForInput) return null;
		const created = await transaction.elicitationRequest.create({ data: {
			id: command.requestId, siloId: command.siloId, conversationId: command.conversationId,
			runId: command.runId, attempt: command.attempt, assignedParticipantId: command.assignedParticipantId,
			requestKey: command.requestKey, purpose: _PrismaPurpose(command.purpose), bodyKind: _PrismaBodyKind(command.body.kind),
			body: command.body as unknown as Prisma.InputJsonValue, bodyDigest,
			purposePayload: command.purposePayload as Prisma.InputJsonValue | undefined,
			purposePayloadDigest: command.purposePayloadDigest, requiresStepUp: command.requiresStepUp,
			expiresAt: command.expiresAt, createdAt: command.now,
		} });
		return _Projection(created);
	}

	/** Attribute, apply, and resume one response. */
	async respond(command: RespondToElicitationCommand): Promise<RespondToElicitationResult>
	{
		const transaction = this._transaction;
		const request = await transaction.elicitationRequest.findUnique({ where: { id: command.requestId } });
		if (request === null || request.siloId !== command.siloId || request.conversationId !== command.conversationId) return { outcome: "not_found" };
		if (request.assignedParticipantId !== command.subjectId) return { outcome: "unauthorized" };
		const responseDigest = __DigestCanonicalJson(command.submission.response as unknown as JsonValue);
		const prior = await transaction.elicitationResponseAttempt.findUnique({ where: { requestId_idempotencyKey: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey } } });
		if (prior !== null)
		{
			if (prior.responseDigest !== responseDigest || prior.state !== ElicitationResponseAttemptState.Accepted || request.resolvedAt === null) return { outcome: "conflict" };
			return { outcome: "accepted", projection: { requestId: request.id, state: _PublicState(request.state), idempotent: true, resolvedAt: request.resolvedAt.toISOString() } };
		}
		if (request.state !== ElicitationRequestState.Requested) return { outcome: "conflict" };
		const participant = await transaction.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: request.conversationId, userId: command.subjectId } } });
		const run = await transaction.agentRun.findUnique({ where: { id: request.runId } });
		if (participant === null || participant.accessEndedPosition !== null || run === null || run.attempt !== request.attempt || run.state !== AgentRunState.WaitingForInput) return { outcome: "unauthorized" };
		if (request.expiresAt.getTime() <= command.now.getTime())
		{
			await this._expireRequest(request, command.now);
			return { outcome: "expired" };
		}
		if (request.requiresStepUp && (command.verifiedStepUpAt === null || command.verifiedStepUpAt.getTime() < request.createdAt.getTime())) return { outcome: "step_up_required" };
		const body = request.body as unknown as ElicitationBody;
		if (!_IsElicitationResponseValid(body, command.submission.response)) return { outcome: "invalid_response" };
		const attempt = await transaction.elicitationResponseAttempt.create({ data: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey, respondingSubjectId: command.subjectId, response: command.submission.response as unknown as Prisma.InputJsonValue, responseDigest, verifiedStepUpAt: command.verifiedStepUpAt, submittedAt: command.now } });
		if (!await this._applyPurpose(request, command.submission.response, command.subjectId, command.now)) throw new Error("elicitation purpose strategy rejected an admitted response");
		const publicState = _ElicitationStateForResponse(command.submission.response);
		const state = publicState === ElicitationRequestStates.Answered ? ElicitationRequestState.Answered : ElicitationRequestState.Declined;
		const resolved = await transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested }, data: { state, resolvedAt: command.now, resolvedBy: command.subjectId } });
		if (resolved.count !== 1) throw new Error("elicitation response lost its request fence");
		await transaction.elicitationResponseAttempt.update({ where: { id: attempt.id }, data: { state: ElicitationResponseAttemptState.Accepted, completedAt: command.now } });
		const pending = await transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		if (pending === 0)
		{
			const resumed = await transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
			if (resumed.count !== 1) throw new Error("elicitation response lost its waiting run fence");
		}
		return { outcome: "accepted", projection: { requestId: request.id, state: publicState, idempotent: false, resolvedAt: command.now.toISOString() } };
	}

	/** Read one request only for its still-active assigned participant. */
	async readOwned(siloId: string, conversationId: string, requestId: string, subjectId: string, now: Date): Promise<ConversationElicitation | null>
	{
		const row = await this._transaction.elicitationRequest.findFirst({ where: { id: requestId, siloId, conversationId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null } } });
		if (row === null) return null;
		return _ProjectionAt(row, now);
	}

	/** List still-actionable requests for one exact conversation and participant. */
	async listOpenOwned(siloId: string, conversationId: string, subjectId: string, now: Date): Promise<readonly ConversationElicitation[]>
	{
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, conversationId, assignedParticipantId: subjectId, state: ElicitationRequestState.Requested, expiresAt: { gt: now }, assignedParticipant: { accessEndedPosition: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 });
		return rows.map(_Projection);
	}

	/** List recent requests as references to canonical conversation/run authority. */
	async listActivityOwned(siloId: string, subjectId: string, limit: number, now: Date): Promise<readonly ConversationElicitation[]>
	{
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("elicitation activity limit must be between one and one hundred");
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
		return rows.map(function _ProjectActivity(row) { return _ProjectionAt(row, now); });
	}

	/** Apply one purpose without allowing the browser to choose protected authority. */
	private async _applyPurpose(request: { id: string; runId: string; attempt: number; purpose: ElicitationPurpose; purposePayload: Prisma.JsonValue | null; purposePayloadDigest: string; assignedParticipantId: string }, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (request.purpose === ElicitationPurpose.ToolApproval) return this._applyToolApproval(request.id, response, subjectId, now);
		if (request.purpose === ElicitationPurpose.PersonalMemoryPermission) return this._applyMemoryPermission(request, response, subjectId, now);
		if (request.purpose === ElicitationPurpose.A2uiAction) return this._applyA2uiAction(request, response);
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload: response as unknown as Prisma.InputJsonValue, payloadDigest: __DigestCanonicalJson(response as unknown as JsonValue) } });
		return true;
	}

	/** Bridge one answer into the existing protected tool authority. */
	private async _applyToolApproval(requestId: string, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval) return false;
		const approval = await this._transaction.approvalRequest.findUnique({ where: { elicitationRequestId: requestId } });
		if (approval === null || approval.reviewedToolArguments === null) return false;
		const decision = response.approved ? DeferredToolDecisionKinds.Approved : DeferredToolDecisionKinds.Denied;
		const approvedArguments = response.approved ? approval.reviewedToolArguments as JsonValue : undefined;
		const result = await __DecideDeferredToolRequest(this._transaction, { approvalRequestId: approval.id, siloId: approval.siloId, subjectId, decision, arguments: approvedArguments, decidedBy: subjectId, now });
		return result.outcome === "approved" || result.outcome === "denied" || result.outcome === "already_decided";
	}

	/** Create only a one-invocation personal-memory permission receipt. */
	private async _applyMemoryPermission(request: { id: string; runId: string; attempt: number; purposePayload: Prisma.JsonValue | null; purposePayloadDigest: string; assignedParticipantId: string }, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval) return false;
		if (!response.approved) return true;
		if (!_Record(request.purposePayload) || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest) return false;
		const executionSubjectId = request.purposePayload["executionSubjectId"];
		const queryDigest = request.purposePayload["queryDigest"];
		const invocationKey = request.purposePayload["invocationKey"];
		const expiresAt = request.purposePayload["expiresAt"];
		if (executionSubjectId !== subjectId || typeof queryDigest !== "string" || typeof invocationKey !== "string" || typeof expiresAt !== "string") return false;
		const expiry = new Date(expiresAt);
		if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now.getTime()) return false;
		await this._transaction.personalMemoryPermissionReceipt.create({ data: { requestId: request.id, runId: request.runId, attempt: request.attempt, subjectId: request.assignedParticipantId, executionSubjectId, purposeDigest: request.purposePayloadDigest, queryDigest, invocationKey, expiresAt: expiry } });
		return true;
	}

	/** Bind a display-only A2UI answer back to the server-owned action coordinates. */
	private async _applyA2uiAction(request: { id: string; purposePayload: Prisma.JsonValue | null; purposePayloadDigest: string }, response: ElicitationResponseValue): Promise<boolean>
	{
		if (!_Record(request.purposePayload) || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest) return false;
		const displayedActionId = request.purposePayload["displayedActionId"];
		const sourceComponentId = request.purposePayload["sourceComponentId"];
		const actionDigest = request.purposePayload["actionDigest"];
		if (typeof displayedActionId !== "string" || displayedActionId.length === 0 || typeof sourceComponentId !== "string" || sourceComponentId.length === 0 || typeof actionDigest !== "string" || actionDigest.length === 0) return false;
		const payload = { kind: "a2ui_action", displayedActionId, sourceComponentId, actionDigest, response };
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload, payloadDigest: __DigestCanonicalJson(payload) } });
		return true;
	}

	/** Expire one request and resume only when no other generic input remains. */
	private async _expireRequest(request: { id: string; runId: string; attempt: number; purpose: ElicitationPurpose }, now: Date): Promise<void>
	{
		if (request.purpose === ElicitationPurpose.ToolApproval) await __ExpireDeferredToolApprovalBatch(this._transaction, { runId: request.runId, attempt: request.attempt, now });
		const expired = await this._transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested, expiresAt: { lte: now } }, data: { state: ElicitationRequestState.Expired, resolvedAt: now, safeReason: "response_window_expired" } });
		if (expired.count !== 1) throw new Error("elicitation expiry lost its request fence");
		if (request.purpose === ElicitationPurpose.RuntimeInput || request.purpose === ElicitationPurpose.A2uiAction) await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id } });
		const pending = await this._transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		if (pending !== 0) return;
		const resumed = await this._transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
		if (resumed.count !== 1) throw new Error("elicitation expiry lost its waiting run fence");
	}
}

/** Process-scoped owner of serializable elicitation transactions. */
export class PrismaElicitationUnitOfWork implements ElicitationUnitOfWork
{
	/** Canonical client used only to begin transactions. */
	private readonly _prisma: PrismaClient;

	/** Bind the transaction owner to product persistence. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/** Open one request atomically. */
	async open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.open", { runId: command.runId, attempt: command.attempt }, function _TraceOpen() { return unit._execute(function _Open(repository) { return repository.open(command); }); });
	}

	/** Respond and resume atomically. */
	async respond(command: RespondToElicitationCommand): Promise<RespondToElicitationResult>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.respond", { siloId: command.siloId, requestId: command.requestId }, function _TraceRespond() { return unit._execute(function _Respond(repository) { return repository.respond(command); }); });
	}

	/** Read one owned request through a short serializable snapshot. */
	async readOwned(siloId: string, conversationId: string, requestId: string, subjectId: string, now: Date): Promise<ConversationElicitation | null>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.read", { siloId, requestId }, function _TraceRead() { return unit._execute(function _Read(repository) { return repository.readOwned(siloId, conversationId, requestId, subjectId, now); }); });
	}

	/** Read current cursorless overlays through a short serializable snapshot. */
	async listOpenOwned(siloId: string, conversationId: string, subjectId: string, now: Date): Promise<readonly ConversationElicitation[]>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.list_open", { siloId, conversationId }, function _TraceListOpen() { return unit._execute(function _List(repository) { return repository.listOpenOwned(siloId, conversationId, subjectId, now); }); });
	}

	/** Read the caller's derived Activity references through a short serializable snapshot. */
	async listActivityOwned(siloId: string, subjectId: string, limit: number, now: Date): Promise<readonly ConversationElicitation[]>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.list_activity", { siloId }, function _TraceListActivity() { return unit._execute(function _List(repository) { return repository.listActivityOwned(siloId, subjectId, limit, now); }); });
	}

	/** Construct exactly one transaction-bound repository. */
	private async _execute<TResult>(work: (repository: ElicitationRepository) => Promise<TResult>): Promise<TResult>
	{
		return this._prisma.$transaction(async function _Transaction(transaction): Promise<TResult>
		{
			return work(new PrismaElicitationRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Project a persistence row into the browser-safe contract without protected payloads. */
function _Projection(row: { id: string; conversationId: string; runId: string; attempt: number; assignedParticipantId: string; purpose: ElicitationPurpose; state: ElicitationRequestState; body: Prisma.JsonValue; requiresStepUp: boolean; createdAt: Date; expiresAt: Date; resolvedAt: Date | null; safeReason: string | null }): ConversationElicitation
{
	let projection: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: row.id, conversationId: row.conversationId, runId: row.runId, attempt: row.attempt, assignedParticipantId: row.assignedParticipantId, purpose: _PublicPurpose(row.purpose), state: _PublicState(row.state), body: row.body as unknown as ElicitationBody, requiresStepUp: row.requiresStepUp, requestedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
	if (row.resolvedAt !== null) projection = { ...projection, resolvedAt: row.resolvedAt.toISOString() };
	if (row.safeReason !== null) projection = { ...projection, safeReason: row.safeReason };
	return projection;
}

/** Derive deadline expiry for reads without mutating canonical request authority. */
function _ProjectionAt(row: Parameters<typeof _Projection>[0], now: Date): ConversationElicitation
{
	if (row.state !== ElicitationRequestState.Requested || row.expiresAt.getTime() > now.getTime()) return _Projection(row);
	return { ..._Projection(row), state: ElicitationRequestStates.Expired, resolvedAt: now.toISOString(), safeReason: "response_window_expired" };
}

/** Map public body kinds to persistence vocabulary. */
function _PrismaBodyKind(kind: ElicitationBodyKinds): ElicitationBodyKind
{
	return { [ElicitationBodyKinds.Approval]: ElicitationBodyKind.Approval, [ElicitationBodyKinds.SingleChoice]: ElicitationBodyKind.SingleChoice, [ElicitationBodyKinds.MultipleChoice]: ElicitationBodyKind.MultipleChoice, [ElicitationBodyKinds.FreeText]: ElicitationBodyKind.FreeText }[kind];
}

/** Map public purposes to persistence vocabulary. */
function _PrismaPurpose(purpose: ElicitationPurposes): ElicitationPurpose
{
	return { [ElicitationPurposes.RuntimeInput]: ElicitationPurpose.RuntimeInput, [ElicitationPurposes.ToolApproval]: ElicitationPurpose.ToolApproval, [ElicitationPurposes.PersonalMemoryPermission]: ElicitationPurpose.PersonalMemoryPermission, [ElicitationPurposes.A2uiAction]: ElicitationPurpose.A2uiAction }[purpose];
}

/** Map persistence purposes to the public contract. */
function _PublicPurpose(purpose: ElicitationPurpose): ElicitationPurposes
{
	return { [ElicitationPurpose.RuntimeInput]: ElicitationPurposes.RuntimeInput, [ElicitationPurpose.ToolApproval]: ElicitationPurposes.ToolApproval, [ElicitationPurpose.PersonalMemoryPermission]: ElicitationPurposes.PersonalMemoryPermission, [ElicitationPurpose.A2uiAction]: ElicitationPurposes.A2uiAction }[purpose];
}

/** Map persistence lifecycle to the public contract. */
function _PublicState(state: ElicitationRequestState): ElicitationRequestStates
{
	return { [ElicitationRequestState.Requested]: ElicitationRequestStates.Requested, [ElicitationRequestState.Answered]: ElicitationRequestStates.Answered, [ElicitationRequestState.Declined]: ElicitationRequestStates.Declined, [ElicitationRequestState.Expired]: ElicitationRequestStates.Expired, [ElicitationRequestState.Cancelled]: ElicitationRequestStates.Cancelled, [ElicitationRequestState.Failed]: ElicitationRequestStates.Failed }[state];
}

/** Whether one protected purpose payload is a non-array JSON record. */
function _Record(value: Prisma.JsonValue | null): value is Prisma.JsonObject
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
