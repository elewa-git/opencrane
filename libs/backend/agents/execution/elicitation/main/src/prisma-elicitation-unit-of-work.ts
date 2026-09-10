import { AgentRunState, ApprovalRequestState, ElicitationBodyKind, ElicitationPurpose, ElicitationRequestState, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __DigestCanonicalJson, __FindToolInvocationInTransaction, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation, type ElicitationBody, type RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _ElicitationStateForResponse, _IsElicitationResponseValid } from "./elicitation-response";
import { PrismaElicitationProductAuthorizationRepository } from "./elicitation-product-authorization";
import type { ElicitationProductAuthorization } from "./elicitation-product-authorization.types";
import { _ElicitationRequestMatchesOpenCommand } from "./elicitation-persistence-mapping";
import type { ElicitationPurposeStrategy, ElicitationPurposeStrategies, PersonalMemoryPermissionPurpose } from "./purposes/elicitation-purpose.types";
import { PrismaRuntimeInputPurposeAuthority } from "./purposes/runtime-input/prisma-runtime-input-purpose";
import { PrismaToolApprovalPurposeAuthority } from "./purposes/tool-approval/prisma-tool-approval-purpose";
import { PrismaA2uiActionPurposeAuthority } from "./purposes/a2ui-action/prisma-a2ui-action-purpose";
import { PrismaPersonalMemoryPermissionPurposeAuthority } from "./purposes/personal-memory/prisma-personal-memory-permission-purpose";
import { _Projection, _ProjectionAt, _PublicPurpose, _PublicState } from "./elicitation-prisma-mapping";
import type { ElicitationRepository, ElicitationRunWakeFactory, ElicitationRunWakePort, ElicitationUnitOfWork, ExpireElicitationBatchCommand, ExpireElicitationBatchResult, OpenElicitationCommand, PersonalMemoryPermissionAuthority, PersonalMemoryPermissionVerificationResult, RespondToElicitationCommand, RespondToElicitationResult } from "./elicitation.types";

/** Prisma repository bound to exactly one serializable elicitation transaction. */
export class PrismaElicitationRepository implements ElicitationRepository
{
	/** Exact transaction used by every read and write. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Owns personal-memory permission payloads, receipts and invocation checks. */
	private readonly _memoryPermission: PersonalMemoryPermissionPurpose;
	/** Central product decisions bound to the elicitation transaction. */
	private readonly _productAuthorization: ElicitationProductAuthorization;
	/** Selects the transaction-bound implementation for every saved purpose. */
	private readonly _purposeStrategies: ElicitationPurposeStrategies;
	/** Optional workflow wake owned by application composition. */
	private readonly _wake: ElicitationRunWakePort | null;

	/** Bind all request, response, purpose, and resume operations to one transaction. */
	constructor(transaction: Prisma.TransactionClient, wake: ElicitationRunWakePort | null = null)
	{
		this._transaction = transaction;
		this._wake = wake;
		this._memoryPermission = new PrismaPersonalMemoryPermissionPurposeAuthority(this._transaction);
		this._productAuthorization = new PrismaElicitationProductAuthorizationRepository(this._transaction);
		this._purposeStrategies = {
			[ElicitationPurposes.RuntimeInput]: new PrismaRuntimeInputPurposeAuthority(this._transaction),
			[ElicitationPurposes.ToolApproval]: new PrismaToolApprovalPurposeAuthority(this._transaction),
			[ElicitationPurposes.PersonalMemoryPermission]: this._memoryPermission,
			[ElicitationPurposes.A2uiAction]: new PrismaA2uiActionPurposeAuthority(this._transaction),
		};
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

	/** Ask the memory purpose to prepare the question, then use the normal request admission. */
	async openMemoryPermission(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<boolean>
	{
		const command = this._memoryPermission.createOpenCommand(invocation, snapshot, now);
		if (command === null)
			return false;
		const opened = await this.open(command);
		return opened !== null;
	}

	/** Delegate receipt and dispatch-claim checks to the memory permission purpose. */
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
			const approval = await transaction.approvalRequest.findUnique({ where: { elicitationRequestId: request.id }, select: { id: true, toolInvocationRowId: true } });
			if (approval === null)
				return { outcome: "unauthorized" };
			approvalRequestId = approval.id;
			const invocation = await __FindToolInvocationInTransaction(transaction, approval.toolInvocationRowId);
			if (invocation === null || invocation.runId !== request.runId || invocation.attempt !== request.attempt)
				return { outcome: "unauthorized" };
		}
		if (!await this._productAuthorization.admitResponse(command.siloId, command.subjectId, command.conversationId, approvalRequestId, command.submission.response as unknown as JsonValue, command.now))
			return { outcome: "unauthorized" };
		await transaction.elicitationResponseAttempt.create({ data: { requestId: request.id, idempotencyKey: command.submission.idempotencyKey, respondingSubjectId: command.subjectId, response: command.submission.response as unknown as Prisma.InputJsonValue, responseDigest, verifiedStepUpAt: command.verifiedStepUpAt, submittedAt: command.now } });
		const publicState = _ElicitationStateForResponse(command.submission.response);
		const state = publicState === ElicitationRequestStates.Answered ? ElicitationRequestState.Answered : ElicitationRequestState.Declined;
		const resolved = await transaction.elicitationRequest.updateMany({ where: { id: request.id, state: ElicitationRequestState.Requested }, data: { state, resolvedAt: command.now, resolvedBy: command.subjectId } });
		if (resolved.count !== 1)
			throw new Error("elicitation response lost its request fence");
		if (!await this._purposeFor(_PublicPurpose(request.purpose)).apply(request, command.submission.response, command.subjectId, command.now))
			throw new Error("elicitation purpose strategy rejected an admitted response");
		const pendingElicitations = await transaction.elicitationRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ElicitationRequestState.Requested } });
		const pendingApprovals = await transaction.approvalRequest.count({ where: { runId: request.runId, attempt: request.attempt, state: ApprovalRequestState.Pending } });
		if (pendingElicitations === 0 && pendingApprovals === 0)
		{
			const resumed = await transaction.agentRun.updateMany({ where: { id: request.runId, attempt: request.attempt, state: AgentRunState.WaitingForInput }, data: { state: AgentRunState.Running } });
			if (resumed.count !== 1)
				throw new Error("elicitation response lost its waiting run fence");
			await this._wakeDecidedToolApprovals(request.runId, request.attempt);
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

	/** Require active organisation membership and continuing participation in the selected conversation. */
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

	/** Refuse unknown saved purposes instead of treating them as ordinary runtime input. */
	private _purposeFor(purpose: ElicitationPurposes): ElicitationPurposeStrategy
	{
		const strategy = this._purposeStrategies[purpose];
		if (strategy === undefined)
			throw new Error(`unsupported elicitation purpose: ${purpose}`);
		return strategy;
	}

	/** Expire one request through its exact purpose, then resume only when no input remains. */
	private async _expireRequest(request: { id: string; runId: string; attempt: number; purpose: ElicitationPurpose; purposePayload: Prisma.JsonValue | null; purposePayloadDigest: string; assignedParticipantId: string; expiresAt: Date }, now: Date): Promise<void>
	{
		await this._purposeFor(_PublicPurpose(request.purpose)).expire(request, now);
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
		await this._wakeDecidedToolApprovals(request.runId, request.attempt);
	}

	/** Wake every terminal tool approval when the last input releases the run. */
	private async _wakeDecidedToolApprovals(runId: string, attempt: number): Promise<void>
	{
		if (this._wake === null)
			return;
		const approvals = await this._transaction.approvalRequest.findMany({ where: { runId, attempt, state: { in: [ApprovalRequestState.Approved, ApprovalRequestState.Denied, ApprovalRequestState.Expired] } }, select: { toolInvocationRowId: true }, orderBy: { id: "asc" } });
		const invocationIds = new Set<string>();
		for (const approval of approvals)
		{
			const invocation = await __FindToolInvocationInTransaction(this._transaction, approval.toolInvocationRowId);
			if (invocation !== null && invocation.runId === runId && invocation.attempt === attempt)
				invocationIds.add(invocation.toolInvocationId);
		}
		for (const invocationId of invocationIds)
			await this._wake.wake(runId, attempt, invocationId);
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
	/** Application-owned workflow wake factory bound inside each response transaction. */
	private readonly _wakeFactory: ElicitationRunWakeFactory | null;

	/** Bind the transaction owner to product persistence. */
	constructor(prisma: PrismaClient, wakeFactory: ElicitationRunWakeFactory | null = null)
	{
		this._prisma = prisma;
		this._wakeFactory = wakeFactory;
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
		const unit = this;
		return this._prisma.$transaction(async function _Transaction(transaction): Promise<TResult>
		{
			const repository = new PrismaElicitationRepository(transaction, unit._wakeFactory === null ? null : unit._wakeFactory(transaction));
			return work(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
