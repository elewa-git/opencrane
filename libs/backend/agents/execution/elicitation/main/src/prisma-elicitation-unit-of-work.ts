import { AgentRunState, ApprovalRequestState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, OrgMemberStatus, PersonalMemoryPermissionReceiptState, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideDeferredToolRequest, __DigestCanonicalJson, __ExpireDeferredToolApprovalBatch, DeferredToolDecisionKinds, DeferredToolDecisionOutcomes, PrismaToolInvocationElicitationRepository, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationElicitationRepository, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationBody, type ElicitationResponseValue, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { _ElicitationStateForResponse, _IsElicitationResponseValid } from "./elicitation-response.js";
import { _ElicitationPurposeStrategies } from "./elicitation-purpose-strategies.js";
import type { ElicitationPurposeRequest, ElicitationPurposeStrategyRegistry } from "./elicitation-purpose-strategy.types.js";
import { PersonalMemoryPermissionVerificationOutcomes, type ElicitationRepository, type ElicitationUnitOfWork, type ExpireElicitationBatchCommand, type ExpireElicitationBatchResult, type OpenElicitationCommand, type PersonalMemoryPermissionAuthority, type PersonalMemoryPermissionVerificationResult, type RespondToElicitationCommand, type RespondToElicitationResult } from "./elicitation.types.js";
import { _ClaimedPersonalMemoryPermissionPayload, _OpenPersonalMemoryPermissionPayload, _PersonalMemoryPurposeMatchesReceipt, _PersonalMemoryQueryDigest } from "./personal-memory-permission-payload.js";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator.js";

/** Prisma repository bound to exactly one serializable elicitation transaction. */
export class PrismaElicitationRepository implements ElicitationRepository
{
	/** Exact transaction used by every read and write. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization owner for every ToolInvocation read and lifecycle transition. */
	private readonly _toolInvocations: ToolInvocationElicitationRepository;
	/** Exhaustive purpose consequences bound to this exact transaction. */
	private readonly _purposeStrategies: ElicitationPurposeStrategyRegistry;

	/** Bind all request, response, purpose, and resume operations to one transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
		this._toolInvocations = new PrismaToolInvocationElicitationRepository(this._transaction);
		const repository = this;
		this._purposeStrategies = new _ElicitationPurposeStrategies({
			applyRuntimeInput(request, response) { return repository._applyRuntimeInput(request, response); },
			applyToolApproval(request, response, subjectId, now) { return repository._applyToolApproval(request, response, subjectId, now); },
			applyPersonalMemoryPermission(request, response, subjectId, now) { return repository._applyMemoryPermission(request, response, subjectId, now); },
			applyA2uiAction(request, response) { return repository._applyA2uiAction(request, response); },
			expireToolApproval(request, now) { return repository._expireToolApproval(request, now); },
			expirePersonalMemoryPermission(request, now) { return repository._expireMemoryPermission(request, now); },
			expireRuntimeDelivery(request) { return repository._expireRuntimeDelivery(request); },
		});
	}

	/** Pause the exact run and create or replay one request. */
	async open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		const transaction = this._transaction;
		const bodyDigest = __DigestCanonicalJson(command.body as unknown as JsonValue);
		if (!await _CanParticipantAccess(transaction, command.siloId, command.conversationId, command.assignedParticipantId)) return null;
		const existing = await transaction.elicitationRequest.findUnique({ where: { runId_attempt_requestKey: { runId: command.runId, attempt: command.attempt, requestKey: command.requestKey } } });
		if (existing !== null) return _RequestMatchesOpenCommand(existing, command, bodyDigest) ? _Projection(existing) : null;
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.siloId !== command.siloId || run.conversationId !== command.conversationId || run.attempt !== command.attempt || command.expiresAt.getTime() <= command.now.getTime()) return null;
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

	/** Open or replay one exact personal-memory permission for the execution user. */
	async openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<boolean>
	{
		const payload = _OpenPersonalMemoryPermissionPayload(invocation, snapshot);
		if (payload === null) return false;
		const body = { kind: ElicitationBodyKinds.Approval, prompt: "Allow this agent to use your personal memory for this answer?", action: "Use personal memory", target: "Your saved memory", dataUse: "Use remembered facts only for this answer", consequence: "The agent will answer this request using relevant saved memory" } as const;
		const opened = await this.open({
			requestId: `memory-permission-${invocation.id}`,
			siloId: invocation.siloId,
			conversationId: snapshot.conversationId as string,
			runId: invocation.runId,
			attempt: invocation.attempt,
			assignedParticipantId: invocation.subjectId,
			requestKey: `memory-permission:${invocation.id}`,
			purpose: ElicitationPurposes.PersonalMemoryPermission,
			body,
			purposePayload: payload as unknown as JsonValue,
			purposePayloadDigest: __DigestCanonicalJson(payload as unknown as JsonValue),
			requiresStepUp: false,
			now,
			expiresAt: new Date(payload.expiresAt),
		});
		return opened !== null;
	}

	/** Verify an accepted exact receipt without consuming it or reading personal-memory content. */
	async verifyMemoryPermission(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		const expectedPayload = _ClaimedPersonalMemoryPermissionPayload(invocation, snapshot);
		if (expectedPayload === null || !await this._toolInvocations.verifyActiveDispatchClaim(invocation, claim, now)) return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const receipt = await this._transaction.personalMemoryPermissionReceipt.findUnique({ where: { toolInvocationId: invocation.id }, include: { request: true } });
		if (receipt === null) return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const request = receipt.request;
		const matches = receipt.state === PersonalMemoryPermissionReceiptState.Active
			&& receipt.consumedAt === null
			&& receipt.expiresAt.getTime() > now.getTime()
			&& receipt.toolInvocationRevision + 1 === invocation.revision
			&& receipt.runId === invocation.runId
			&& receipt.attempt === invocation.attempt
			&& receipt.executionSubjectId === invocation.subjectId
			&& receipt.respondingSubjectId === invocation.subjectId
			&& receipt.queryDigest === expectedPayload.queryDigest
			&& receipt.inputSnapshotDigest === expectedPayload.inputSnapshotDigest
			&& receipt.personaRevisionId === expectedPayload.personaRevisionId
			&& request.purpose === ElicitationPurpose.PersonalMemoryPermission
			&& request.state === ElicitationRequestState.Answered
			&& request.assignedParticipantId === invocation.subjectId
			&& request.resolvedBy === invocation.subjectId
			&& request.purposePayloadDigest === receipt.purposeDigest
			&& _PersonalMemoryPurposeMatchesReceipt(request.purposePayload, receipt);
		return { outcome: matches ? PersonalMemoryPermissionVerificationOutcomes.Authorized : PersonalMemoryPermissionVerificationOutcomes.Denied };
	}

	/** Attribute, apply, and resume one response. */
	async respond(command: RespondToElicitationCommand): Promise<RespondToElicitationResult>
	{
		const transaction = this._transaction;
		const request = await transaction.elicitationRequest.findUnique({ where: { id: command.requestId } });
		if (request === null || request.siloId !== command.siloId || request.conversationId !== command.conversationId) return { outcome: "not_found" };
		if (request.assignedParticipantId !== command.subjectId) return { outcome: "unauthorized" };
		if (!await _CanParticipantAccess(transaction, command.siloId, command.conversationId, command.subjectId)) return { outcome: "unauthorized" };
		const responseDigest = __DigestCanonicalJson(command.submission.response as unknown as JsonValue);
		const prior = await transaction.elicitationResponseAttempt.findUnique({ where: { requestId_idempotencyKey: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey } } });
		if (prior !== null)
		{
			if (prior.responseDigest !== responseDigest || request.resolvedAt === null) return { outcome: "conflict" };
			return { outcome: "accepted", projection: { requestId: request.id, state: _PublicState(request.state), idempotent: true, resolvedAt: request.resolvedAt.toISOString() } };
		}
		if (request.state !== ElicitationRequestState.Requested) return { outcome: "conflict" };
		const run = await transaction.agentRun.findUnique({ where: { id: request.runId } });
		if (run === null || run.attempt !== request.attempt || run.state !== AgentRunState.WaitingForInput) return { outcome: "unauthorized" };
		if (request.expiresAt.getTime() <= command.now.getTime())
		{
			await this._expireRequest(request, command.now);
			return { outcome: "expired" };
		}
		if (request.requiresStepUp && (command.verifiedStepUpAt === null || command.verifiedStepUpAt.getTime() < request.createdAt.getTime())) return { outcome: "step_up_required" };
		const body = request.body as unknown as ElicitationBody;
		if (!_IsElicitationResponseValid(body, command.submission.response)) return { outcome: "invalid_response" };
		await transaction.elicitationResponseAttempt.create({ data: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey, respondingSubjectId: command.subjectId, response: command.submission.response as unknown as Prisma.InputJsonValue, responseDigest, verifiedStepUpAt: command.verifiedStepUpAt, submittedAt: command.now } });
		const publicState = _ElicitationStateForResponse(command.submission.response);
		const state = publicState === ElicitationRequestStates.Answered ? ElicitationRequestState.Answered : ElicitationRequestState.Declined;
		const resolved = await transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested }, data: { state, resolvedAt: command.now, resolvedBy: command.subjectId } });
		if (resolved.count !== 1) throw new Error("elicitation response lost its request fence");
		if (!await this._purposeStrategies.forPurpose(_PublicPurpose(request.purpose)).apply(request, command.submission.response, command.subjectId, command.now)) throw new Error("elicitation purpose strategy rejected an admitted response");
		const pendingElicitations = await transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		const pendingApprovals = await transaction.approvalRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ApprovalRequestState.Pending } });
		if (pendingElicitations === 0 && pendingApprovals === 0)
		{
			const resumed = await transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
			if (resumed.count !== 1) throw new Error("elicitation response lost its waiting run fence");
		}
		return { outcome: "accepted", projection: { requestId: request.id, state: publicState, idempotent: false, resolvedAt: command.now.toISOString() } };
	}

	/** Read one request only for its still-active assigned participant. */
	async readOwned(siloId: string, conversationId: string, requestId: string, subjectId: string, now: Date): Promise<ConversationElicitation | null>
	{
		if (!await _CanParticipantAccess(this._transaction, siloId, conversationId, subjectId)) return null;
		const row = await this._transaction.elicitationRequest.findFirst({ where: { id: requestId, siloId, conversationId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null } } });
		if (row === null) return null;
		return _ProjectionAt(row, now);
	}

	/** List still-actionable requests for one exact conversation and participant. */
	async listOpenOwned(siloId: string, conversationId: string, subjectId: string, now: Date): Promise<readonly ConversationElicitation[]>
	{
		if (!await _CanParticipantAccess(this._transaction, siloId, conversationId, subjectId)) return [];
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, conversationId, assignedParticipantId: subjectId, state: ElicitationRequestState.Requested, expiresAt: { gt: now }, assignedParticipant: { accessEndedPosition: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 });
		return rows.map(_Projection);
	}

	/** List recent requests as references to canonical conversation/run authority. */
	async listActivityOwned(siloId: string, subjectId: string, limit: number, now: Date): Promise<readonly ConversationElicitation[]>
	{
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new TypeError("elicitation activity limit must be between one and one hundred");
		const membership = await this._transaction.orgMembership.count({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active } });
		if (membership !== 1) return [];
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null, conversation: _ConversationAccessWhere(siloId, subjectId) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
		return rows.map(function _ProjectActivity(row) { return _ProjectionAt(row, now); });
	}

	/** Expire every due request through its purpose strategy under the caller's run lock. */
	async expireDue(command: ExpireElicitationBatchCommand): Promise<ExpireElicitationBatchResult>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.WaitingForInput) return { expiredCount: 0, resumed: false };
		const due = await this._transaction.elicitationRequest.findMany({ where: { runId: command.runId, attempt: command.attempt, state: ElicitationRequestState.Requested, expiresAt: { lte: command.now } }, orderBy: { id: "asc" } });
		let expiredCount = 0;
		for (const request of due)
		{
			await this._expireRequest(request, command.now);
			expiredCount += 1;
		}
		const after = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		return { expiredCount, resumed: after?.state === AgentRunState.Running };
	}

	/** Persist one validated ordinary runtime response. */
	private async _applyRuntimeInput(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>
	{
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload: response as unknown as Prisma.InputJsonValue, payloadDigest: __DigestCanonicalJson(response as unknown as JsonValue) } });
		return true;
	}

	/** Bridge one answer into the existing protected tool authority. */
	private async _applyToolApproval(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval) return false;
		const approval = await this._transaction.approvalRequest.findUnique({ where: { elicitationRequestId: request.id } });
		if (approval === null || approval.reviewedToolArguments === null) return false;
		const decision = response.approved ? DeferredToolDecisionKinds.Approved : DeferredToolDecisionKinds.Denied;
		const approvedArguments = response.approved ? approval.reviewedToolArguments as JsonValue : undefined;
		const result = await __DecideDeferredToolRequest(this._transaction, { approvalRequestId: approval.id, siloId: approval.siloId, subjectId, decision, arguments: approvedArguments, decidedBy: subjectId, now });
		return result.outcome === DeferredToolDecisionOutcomes.Approved || result.outcome === DeferredToolDecisionOutcomes.Denied || result.outcome === DeferredToolDecisionOutcomes.AlreadyDecided;
	}

	/** Create only a one-invocation personal-memory permission receipt. */
	private async _applyMemoryPermission(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval) return false;
		const payload = _ParsePersonalMemoryPermissionPayload(request.purposePayload);
		if (payload === null || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest) return false;
		const invocation = await this._toolInvocations.findById(payload.toolInvocationId);
		const snapshot = await this._transaction.runInputSnapshot.findUnique({ where: { runId: request.runId } });
		if (invocation === null || snapshot === null) return false;
		const exact = invocation.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION
			&& invocation.state === ToolInvocationStates.AwaitingApproval
			&& invocation.revision === payload.toolInvocationRevision
			&& invocation.runId === request.runId
			&& invocation.attempt === request.attempt
			&& invocation.subjectId === subjectId
			&& request.assignedParticipantId === subjectId
			&& payload.executionSubjectId === subjectId
			&& payload.queryDigest === _PersonalMemoryQueryDigest(invocation.effectiveArguments as unknown as JsonValue)
			&& payload.inputSnapshotDigest === snapshot.digest
			&& payload.personaRevisionId === snapshot.personaRevisionId
			&& payload.expiresAt === request.expiresAt.toISOString()
			&& request.expiresAt.getTime() > now.getTime();
		if (!exact) return false;
		if (!response.approved) return this._toolInvocations.reject({ invocationId: invocation.id, now, failureCode: "memory_permission_declined" });
		const approved = await this._toolInvocations.approve({ invocationId: invocation.id, expectedArguments: invocation.arguments, expectedArgumentsDigest: invocation.argumentsDigest, effectiveArguments: invocation.effectiveArguments, effectiveArgumentsDigest: invocation.effectiveArgumentsDigest });
		if (!approved) return false;
		await this._transaction.personalMemoryPermissionReceipt.create({ data: { requestId: request.id, toolInvocationId: invocation.id, toolInvocationRevision: payload.toolInvocationRevision + 1, runId: request.runId, attempt: request.attempt, executionSubjectId: subjectId, respondingSubjectId: subjectId, queryDigest: payload.queryDigest, inputSnapshotDigest: payload.inputSnapshotDigest, personaRevisionId: payload.personaRevisionId, purposeDigest: request.purposePayloadDigest, state: PersonalMemoryPermissionReceiptState.Active, expiresAt: request.expiresAt } });
		return true;
	}

	/** Bind a display-only A2UI answer back to server-owned action coordinates. */
	private async _applyA2uiAction(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>
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

	/** Expire a deferred approval through its existing lifecycle authority. */
	private async _expireToolApproval(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		await __ExpireDeferredToolApprovalBatch(this._transaction, { runId: request.runId, attempt: request.attempt, now });
	}

	/** Reject the exact invocation named by an expiring memory permission. */
	private async _expireMemoryPermission(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		const payload = _ParsePersonalMemoryPermissionPayload(request.purposePayload);
		if (payload === null
			|| __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest
			|| payload.runId !== request.runId
			|| payload.attempt !== request.attempt
			|| payload.executionSubjectId !== request.assignedParticipantId
			|| payload.expiresAt !== request.expiresAt.toISOString()) throw new Error("personal-memory permission expiry lost its protected payload fence");
		const invocation = await this._toolInvocations.findById(payload.toolInvocationId);
		if (invocation === null
			|| invocation.id !== payload.toolInvocationId
			|| invocation.toolRevisionId !== PERSONAL_MEMORY_RECALL_TOOL_REVISION
			|| invocation.state !== ToolInvocationStates.AwaitingApproval
			|| invocation.revision !== payload.toolInvocationRevision
			|| invocation.runId !== payload.runId
			|| invocation.attempt !== payload.attempt
			|| invocation.subjectId !== payload.executionSubjectId) throw new Error("personal-memory permission expiry lost its invocation fence");
		if (!await this._toolInvocations.reject({ invocationId: payload.toolInvocationId, now, failureCode: "memory_permission_expired" })) throw new Error("personal-memory permission expiry lost its invocation fence");
	}

	/** Publish an empty terminal delivery for runtime-visible expiry. */
	private async _expireRuntimeDelivery(request: ElicitationPurposeRequest): Promise<void>
	{
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id } });
	}

	/** Expire one request through its exact purpose, then resume only when no input remains. */
	private async _expireRequest(request: { id: string; runId: string; attempt: number; purpose: ElicitationPurpose; purposePayload: Prisma.JsonValue | null; purposePayloadDigest: string; assignedParticipantId: string; expiresAt: Date }, now: Date): Promise<void>
	{
		await this._purposeStrategies.forPurpose(_PublicPurpose(request.purpose)).expire(request, now);
		const expired = await this._transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested, expiresAt: { lte: now } }, data: { state: ElicitationRequestState.Expired, resolvedAt: now, safeReason: "response_window_expired" } });
		if (expired.count !== 1) throw new Error("elicitation expiry lost its request fence");
		const pendingElicitations = await this._transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		const pendingApprovals = await this._transaction.approvalRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ApprovalRequestState.Pending } });
		if (pendingElicitations !== 0 || pendingApprovals !== 0) return;
		const resumed = await this._transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
		if (resumed.count !== 1) throw new Error("elicitation expiry lost its waiting run fence");
	}
}

/**
 * Prove both current silo membership and continuing parent-mirrored Agent-thread access.
 * Ordinary conversations satisfy the null-origin branch; child sessions additionally require the
 * same subject to remain an active participant of their immutable immediate parent.
 */
async function _CanParticipantAccess(transaction: Prisma.TransactionClient, siloId: string, conversationId: string, subjectId: string): Promise<boolean>
{
	const membership = await transaction.orgMembership.count({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active } });
	if (membership !== 1) return false;
	const participant = await transaction.conversationParticipant.findFirst({ where: {
		conversationId,
		userId: subjectId,
		accessEndedPosition: null,
		conversation: _ConversationAccessWhere(siloId, subjectId),
	} });
	return participant !== null;
}

/** Current parent-coupled conversation relation used by single and activity reads. */
function _ConversationAccessWhere(siloId: string, subjectId: string): Prisma.ConversationWhereInput
{
	return {
		siloId,
		OR: [
			{ originAgentThread: { is: null } },
			{ originAgentThread: { is: { parentConversation: { participants: { some: { userId: subjectId, accessEndedPosition: null } } } } } },
		],
	};
}

/** Process-scoped owner of serializable elicitation transactions. */
export class PrismaElicitationUnitOfWork implements ElicitationUnitOfWork, PersonalMemoryPermissionAuthority
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

	/** Open one exact personal-memory permission through the elicitation transaction owner. */
	async openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<boolean>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.memory_permission.open", { runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId }, function _TraceOpen() { return unit._execute(function _Open(repository) { return repository.openMemoryPermission(invocation, snapshot, now); }); });
	}

	/** Verify the exact accepted receipt without consuming it or contacting personal memory. */
	async verifyMemoryPermission(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		const unit = this;
		return ___DoWithTrace("elicitation.memory_permission.verify", { runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, claimFence: claim.fence }, function _TraceVerify() { return unit._execute(function _Verify(repository) { return repository.verifyMemoryPermission(invocation, claim, snapshot, now); }); });
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
			const repository = new PrismaElicitationRepository(transaction);
			return work(repository);
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

/** Compare every runtime-controlled request field on replay; trusted times may differ between posts. */
function _RequestMatchesOpenCommand(row: { id: string; siloId: string; conversationId: string; runId: string; attempt: number; assignedParticipantId: string; requestKey: string; purpose: ElicitationPurpose; bodyKind: ElicitationBodyKind; bodyDigest: string; purposePayloadDigest: string; requiresStepUp: boolean }, command: OpenElicitationCommand, bodyDigest: string): boolean
{
	return row.id === command.requestId
		&& row.siloId === command.siloId
		&& row.conversationId === command.conversationId
		&& row.runId === command.runId
		&& row.attempt === command.attempt
		&& row.assignedParticipantId === command.assignedParticipantId
		&& row.requestKey === command.requestKey
		&& row.purpose === _PrismaPurpose(command.purpose)
		&& row.bodyKind === _PrismaBodyKind(command.body.kind)
		&& row.bodyDigest === bodyDigest
		&& row.purposePayloadDigest === command.purposePayloadDigest
		&& row.requiresStepUp === command.requiresStepUp;
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
	return { [ElicitationRequestState.Requested]: ElicitationRequestStates.Requested, [ElicitationRequestState.Answered]: ElicitationRequestStates.Answered, [ElicitationRequestState.Declined]: ElicitationRequestStates.Declined, [ElicitationRequestState.Expired]: ElicitationRequestStates.Expired, [ElicitationRequestState.Cancelled]: ElicitationRequestStates.Cancelled }[state];
}

/** Whether one protected purpose payload is a non-array JSON record. */
function _Record(value: unknown): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
