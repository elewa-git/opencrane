import { AgentRunState, ApprovalRequestState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, OrgMemberStatus, PersonalMemoryPermissionReceiptState, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DecideDeferredToolRequest, __DigestCanonicalJson, __ExpireDeferredToolApprovalBatch, DeferredToolDecisionKinds, DeferredToolDecisionOutcomes, PrismaToolInvocationElicitationRepository, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationElicitationRepository, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationBody, type ElicitationResponseValue, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { _ApprovalScopeOf } from "./elicitation-approval-grant";
import type { ApprovalGrantRepository } from "./elicitation-approval-grant.types";
import { _ElicitationStateForResponse, _IsElicitationResponseValid } from "./elicitation-response";
import { PrismaApprovalGrantRepository } from "./prisma-elicitation-approval-grants";
import { PrismaElicitationProductAuthorizationRepository } from "./elicitation-product-authorization";
import type { ElicitationProductAuthorization } from "./elicitation-product-authorization.types";
import { _ElicitationRequestMatchesOpenCommand } from "./elicitation-persistence-mapping";
import { _ElicitationPurposeStrategies } from "./elicitation-purpose-strategies";
import type { ElicitationPurposeRequest, ElicitationPurposeStrategyRegistry } from "./elicitation-purpose-strategy.types";
import { _Projection, _ProjectionAt, _PublicPurpose, _PublicState, _Record } from "./elicitation-prisma-mapping";
import { PersonalMemoryPermissionVerificationOutcomes, type ElicitationRepository, type ElicitationUnitOfWork, type ExpireElicitationBatchCommand, type ExpireElicitationBatchResult, type OpenElicitationCommand, type PersonalMemoryPermissionAuthority, type PersonalMemoryPermissionVerificationResult, type RespondToElicitationCommand, type RespondToElicitationResult } from "./elicitation.types";
import { PrismaPersonalMemoryPermissionAuthority } from "./prisma-personal-memory-permission";
import type { MemoryPermissionOpenOutcomes } from "./personal-memory-permission.types";

/** Prisma repository bound to exactly one serializable elicitation transaction. */
export class PrismaElicitationRepository implements ElicitationRepository
{
	/** Exact transaction used by every read and write. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization owner for every ToolInvocation read and lifecycle transition. */
	private readonly _toolInvocations: ToolInvocationElicitationRepository;
	/** Central product decisions bound to the elicitation transaction. */
	private readonly _productAuthorization: ElicitationProductAuthorization;
	/** Exhaustive purpose consequences bound to this exact transaction. */
	private readonly _purposeStrategies: ElicitationPurposeStrategyRegistry;
	/** Standing approval grants that let a question stop being asked. */
	private readonly _grants: ApprovalGrantRepository;
	/** Personal-memory consent gate bound to this exact transaction. */
	private readonly _memoryPermission: PrismaPersonalMemoryPermissionAuthority;

	/** Bind all request, response, purpose, and resume operations to one transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
		this._toolInvocations = new PrismaToolInvocationElicitationRepository(this._transaction);
		this._productAuthorization = new PrismaElicitationProductAuthorizationRepository(this._transaction);
		const repository = this;
		this._grants = new PrismaApprovalGrantRepository(this._transaction);
		this._memoryPermission = new PrismaPersonalMemoryPermissionAuthority(this._transaction, this._toolInvocations, this._grants, function _Open(command) { return repository.open(command); });
		this._purposeStrategies = new _ElicitationPurposeStrategies({
			applyRuntimeInput(request, response) { return repository._applyRuntimeInput(request, response); },
			applyToolApproval(request, response, subjectId, now) { return repository._applyToolApproval(request, response, subjectId, now); },
			applyPersonalMemoryPermission(request, response, subjectId, now) { return repository._memoryPermission.apply(request, response, subjectId, now); },
			applyA2uiAction(request, response) { return repository._applyA2uiAction(request, response); },
			expireToolApproval(request, now) { return repository._expireToolApproval(request, now); },
			expirePersonalMemoryPermission(request, now) { return repository._memoryPermission.expire(request, now); },
			expireRuntimeDelivery(request) { return repository._expireRuntimeDelivery(request); },
		});
	}

	/** Pause the exact run and create or replay one request. */
	async open(command: OpenElicitationCommand): Promise<ConversationElicitation | null>
	{
		const transaction = this._transaction;
		const bodyDigest = __DigestCanonicalJson(command.body as unknown as JsonValue);
		if (!await this._canParticipantAccess(command.siloId, command.conversationId, command.assignedParticipantId))
			return null;
		const existing = await transaction.elicitationRequest.findUnique({ where: { runId_attempt_requestKey: { runId: command.runId, attempt: command.attempt, requestKey: command.requestKey } } });
		if (existing !== null)
			return _ElicitationRequestMatchesOpenCommand(existing, command, bodyDigest, _PrismaPurpose(command.purpose), _PrismaBodyKind(command.body.kind)) ? _Projection(existing) : null;
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.siloId !== command.siloId || run.conversationId !== command.conversationId || run.attempt !== command.attempt || command.expiresAt.getTime() <= command.now.getTime())
			return null;
		if (run.state === AgentRunState.Running)
		{
			const paused = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
			if (paused.count !== 1)
				return null;
		}
		else if (run.state !== AgentRunState.WaitingForInput)
			return null;
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
	openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<MemoryPermissionOpenOutcomes>
	{
		return this._memoryPermission.open(invocation, snapshot, now);
	}

	/** Verify an accepted exact receipt without consuming it or reading personal-memory content. */
	verifyMemoryPermission(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		return this._memoryPermission.verify(invocation, claim, snapshot, now);
	}

	/** Attribute, apply, and resume one response. */
	async respond(command: RespondToElicitationCommand): Promise<RespondToElicitationResult>
	{
		const transaction = this._transaction;
		const request = await transaction.elicitationRequest.findUnique({ where: { id: command.requestId } });
		if (request === null || request.siloId !== command.siloId || request.conversationId !== command.conversationId)
			return { outcome: "not_found" };
		if (request.assignedParticipantId !== command.subjectId)
			return { outcome: "unauthorized" };
		if (!await this._canParticipantAccess(command.siloId, command.conversationId, command.subjectId))
			return { outcome: "unauthorized" };
		const responseDigest = __DigestCanonicalJson(command.submission.response as unknown as JsonValue);
		const prior = await transaction.elicitationResponseAttempt.findUnique({ where: { requestId_idempotencyKey: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey } } });
		if (prior !== null)
		{
			if (prior.responseDigest !== responseDigest || request.resolvedAt === null)
				return { outcome: "conflict" };
			return { outcome: "accepted", projection: { requestId: request.id, state: _PublicState(request.state), idempotent: true, resolvedAt: request.resolvedAt.toISOString() } };
		}
		if (request.state !== ElicitationRequestState.Requested)
			return { outcome: "conflict" };
		const run = await transaction.agentRun.findUnique({ where: { id: request.runId } });
		if (run === null || run.attempt !== request.attempt || run.state !== AgentRunState.WaitingForInput)
			return { outcome: "unauthorized" };
		if (request.expiresAt.getTime() <= command.now.getTime())
		{
			await this._expireRequest(request, command.now);
			return { outcome: "expired" };
		}
		if (request.requiresStepUp && (command.verifiedStepUpAt === null || command.verifiedStepUpAt.getTime() < request.createdAt.getTime()))
			return { outcome: "step_up_required" };
		const body = request.body as unknown as ElicitationBody;
		if (!_IsElicitationResponseValid(body, command.submission.response))
			return { outcome: "invalid_response" };
		let approvalRequestId: string | null = null;
		if (request.purpose === ElicitationPurpose.ToolApproval)
		{
			const approval = await transaction.approvalRequest.findUnique({ where: { elicitationRequestId: request.id }, select: { id: true } });
			if (approval === null)
				return { outcome: "unauthorized" };
			approvalRequestId = approval.id;
		}
		if (!await this._productAuthorization.admitResponse(command.siloId, command.subjectId, command.conversationId, approvalRequestId, command.submission.response as unknown as JsonValue, command.now))
			return { outcome: "unauthorized" };
		await transaction.elicitationResponseAttempt.create({ data: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey, respondingSubjectId: command.subjectId, response: command.submission.response as unknown as Prisma.InputJsonValue, responseDigest, verifiedStepUpAt: command.verifiedStepUpAt, submittedAt: command.now } });
		const publicState = _ElicitationStateForResponse(command.submission.response);
		const state = publicState === ElicitationRequestStates.Answered ? ElicitationRequestState.Answered : ElicitationRequestState.Declined;
		const resolved = await transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested }, data: { state, resolvedAt: command.now, resolvedBy: command.subjectId } });
		if (resolved.count !== 1)
			throw new Error("elicitation response lost its request fence");
		if (!await this._purposeStrategies.forPurpose(_PublicPurpose(request.purpose)).apply(request, command.submission.response, command.subjectId, command.now))
			throw new Error("elicitation purpose strategy rejected an admitted response");
		const pendingElicitations = await transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		const pendingApprovals = await transaction.approvalRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ApprovalRequestState.Pending } });
		if (pendingElicitations === 0 && pendingApprovals === 0)
		{
			const resumed = await transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
			if (resumed.count !== 1)
				throw new Error("elicitation response lost its waiting run fence");
		}
		return { outcome: "accepted", projection: { requestId: request.id, state: publicState, idempotent: false, resolvedAt: command.now.toISOString() } };
	}

	/** Read one request only for its still-active assigned participant. */
	async readOwned(siloId: string, conversationId: string, requestId: string, subjectId: string, now: Date): Promise<ConversationElicitation | null>
	{
		if (!await this._canParticipantAccess(siloId, conversationId, subjectId))
			return null;
		if (!await this._productAuthorization.canReadConversation(siloId, subjectId, conversationId, now))
			return null;
		const row = await this._transaction.elicitationRequest.findFirst({ where: { id: requestId, siloId, conversationId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null } } });
		if (row === null)
			return null;
		return _ProjectionAt(row, now);
	}

	/** List still-actionable requests for one exact conversation and participant. */
	async listOpenOwned(siloId: string, conversationId: string, subjectId: string, now: Date): Promise<readonly ConversationElicitation[]>
	{
		if (!await this._canParticipantAccess(siloId, conversationId, subjectId))
			return [];
		if (!await this._productAuthorization.canReadConversation(siloId, subjectId, conversationId, now))
			return [];
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, conversationId, assignedParticipantId: subjectId, state: ElicitationRequestState.Requested, expiresAt: { gt: now }, assignedParticipant: { accessEndedPosition: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50 });
		return rows.map(_Projection);
	}

	/** List recent requests as references to canonical conversation/run authority. */
	async listActivityOwned(siloId: string, subjectId: string, limit: number, now: Date): Promise<readonly ConversationElicitation[]>
	{
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
			throw new TypeError("elicitation activity limit must be between one and one hundred");
		const membership = await this._transaction.orgMembership.count({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active } });
		if (membership !== 1)
			return [];
		const rows = await this._transaction.elicitationRequest.findMany({ where: { siloId, assignedParticipantId: subjectId, assignedParticipant: { accessEndedPosition: null, conversation: _ConversationAccessWhere(siloId) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
		const readableConversationIds = await this._productAuthorization.filterReadableConversationIds(siloId, subjectId, rows.map(row => row.conversationId), now);
		return rows.filter(row => readableConversationIds.has(row.conversationId)).map(function _ProjectActivity(row) { return _ProjectionAt(row, now); });
	}

	/**
	 * Checks current silo membership and continuing access to the requested conversation.
	 *
	 * Ordinary conversations use the null-origin branch in `_ConversationAccessWhere`. An Agent
	 * thread also requires the subject to remain an active participant in its immediate parent, so
	 * losing parent access stops new requests, responses, and reads from the child.
	 */
	private async _canParticipantAccess(siloId: string, conversationId: string, subjectId: string): Promise<boolean>
	{
		const membership = await this._transaction.orgMembership.count({ where: { clusterTenant: siloId, subject: subjectId, status: OrgMemberStatus.Active } });
		if (membership !== 1)
			return false;
		const participant = await this._transaction.conversationParticipant.findFirst({ where: {
			conversationId,
			userId: subjectId,
			accessEndedPosition: null,
			conversation: _ConversationAccessWhere(siloId),
		} });
		return participant !== null;
	}

	/** Expire every due request through its purpose strategy under the caller's run lock. */
	async expireDue(command: ExpireElicitationBatchCommand): Promise<ExpireElicitationBatchResult>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.WaitingForInput)
			return { expiredCount: 0, resumed: false };
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
		if (response.kind !== ElicitationBodyKinds.Approval)
			return false;
		const approval = await this._transaction.approvalRequest.findUnique({ where: { elicitationRequestId: request.id } });
		if (approval === null || approval.reviewedToolArguments === null)
			return false;
		const decision = response.approved ? DeferredToolDecisionKinds.Approved : DeferredToolDecisionKinds.Denied;
		const approvedArguments = response.approved ? approval.reviewedToolArguments as JsonValue : undefined;
		const result = await __DecideDeferredToolRequest(this._transaction, { approvalRequestId: approval.id, siloId: approval.siloId, reviewerSubjectId: subjectId, decision, arguments: approvedArguments, decidedBy: subjectId, now });
		const decided = result.outcome === DeferredToolDecisionOutcomes.Approved || result.outcome === DeferredToolDecisionOutcomes.Denied || result.outcome === DeferredToolDecisionOutcomes.AlreadyDecided;
		if (decided && result.outcome !== DeferredToolDecisionOutcomes.Denied)
			await this._mintToolApprovalGrant(request, response, approval, subjectId);
		return decided;
	}

	/**
	 * Record the standing grant behind a tool approval answered "this session" or "every time".
	 *
	 * Keyed to the tool's resource and action rather than to the exact arguments, because the person
	 * agreed to stop being asked about this tool, not about one call of it. The decision above still
	 * governs THIS call; the grant only spares the next one a question.
	 */
	private async _mintToolApprovalGrant(request: ElicitationPurposeRequest, response: ElicitationResponseValue, approval: { siloId: string; resourceKind: string; resourceId: string; action: string }, subjectId: string): Promise<void>
	{
		const scope = _ApprovalScopeOf(response);
		if (scope === ElicitationApprovalScopes.Once)
			return;
		const conversation = await this._transaction.elicitationRequest.findUnique({ where: { id: request.id }, select: { conversationId: true } });
		if (conversation === null)
			return;
		await this._grants.mint({
			siloId: approval.siloId,
			purpose: ElicitationPurposes.ToolApproval,
			subjectId,
			resourceKind: approval.resourceKind,
			resourceId: approval.resourceId,
			action: approval.action,
			scope,
			conversationId: conversation.conversationId,
			requestId: request.id,
			expiresAt: null,
		});
	}

	/** Bind a display-only A2UI answer back to server-owned action coordinates. */
	private async _applyA2uiAction(request: ElicitationPurposeRequest, response: ElicitationResponseValue): Promise<boolean>
	{
		if (!_Record(request.purposePayload) || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest)
			return false;
		const displayedActionId = request.purposePayload["displayedActionId"];
		const sourceComponentId = request.purposePayload["sourceComponentId"];
		const actionDigest = request.purposePayload["actionDigest"];
		if (typeof displayedActionId !== "string" || displayedActionId.length === 0 || typeof sourceComponentId !== "string" || sourceComponentId.length === 0 || typeof actionDigest !== "string" || actionDigest.length === 0)
			return false;
		const payload = { kind: "a2ui_action", displayedActionId, sourceComponentId, actionDigest, response };
		await this._transaction.elicitationResultDelivery.create({ data: { requestId: request.id, payload, payloadDigest: __DigestCanonicalJson(payload) } });
		return true;
	}

	/** Expire a deferred approval through its existing lifecycle authority. */
	private async _expireToolApproval(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		await __ExpireDeferredToolApprovalBatch(this._transaction, { runId: request.runId, attempt: request.attempt, now });
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
		if (expired.count !== 1)
			throw new Error("elicitation expiry lost its request fence");
		const pendingElicitations = await this._transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		const pendingApprovals = await this._transaction.approvalRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ApprovalRequestState.Pending } });
		if (pendingElicitations !== 0 || pendingApprovals !== 0)
			return;
		const resumed = await this._transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
		if (resumed.count !== 1)
			throw new Error("elicitation expiry lost its waiting run fence");
	}
}

/** Restrict elicitation reads to the selected silo's conversation. */
function _ConversationAccessWhere(siloId: string): Prisma.ConversationWhereInput { return { siloId }; }

/** Map the public body kind to Prisma vocabulary. */
function _PrismaBodyKind(kind: ElicitationBodyKinds): ElicitationBodyKind { return { [ElicitationBodyKinds.Approval]: ElicitationBodyKind.Approval, [ElicitationBodyKinds.SingleChoice]: ElicitationBodyKind.SingleChoice, [ElicitationBodyKinds.MultipleChoice]: ElicitationBodyKind.MultipleChoice, [ElicitationBodyKinds.FreeText]: ElicitationBodyKind.FreeText }[kind]; }

/** Map the public purpose to Prisma vocabulary. */
function _PrismaPurpose(purpose: ElicitationPurposes): ElicitationPurpose { return { [ElicitationPurposes.RuntimeInput]: ElicitationPurpose.RuntimeInput, [ElicitationPurposes.ToolApproval]: ElicitationPurpose.ToolApproval, [ElicitationPurposes.PersonalMemoryPermission]: ElicitationPurpose.PersonalMemoryPermission, [ElicitationPurposes.A2uiAction]: ElicitationPurpose.A2uiAction }[purpose]; }

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
	async openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<MemoryPermissionOpenOutcomes>
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
