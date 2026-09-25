import { ElicitationPurpose, ElicitationRequestState, MemoryDatasetSensitivity, MemoryDatasetState, PersonalMemoryPermissionReceiptState, Prisma } from "@prisma/client";

import { __DigestCanonicalJson, PrismaToolInvocationElicitationRepository, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationElicitationRepository, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, type ElicitationResponseValue, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { MEMORY_DATASET_RESOURCE_KIND, MEMORY_RECALL_ACTION, _ApprovalScopeOf, _MemoryOfferedScopes } from "../../elicitation-approval-grant";
import type { ApprovalGrantCoordinates, ApprovalGrantRepository } from "../../elicitation-approval-grant.types";
import { MemoryPermissionOpenOutcomes, PersonalMemoryPermissionVerificationOutcomes, type PersonalMemoryPermissionVerificationResult } from "../../elicitation.types";
import { PrismaApprovalGrantRepository } from "../../prisma-elicitation-approval-grants";
import { _BuildMemoryPermissionPayload, _BuildMemoryPermissionPayloadForClaimedInvocation, _InvocationExecutionPrincipalId, _MemoryPurposeMatchesReceipt, _MemoryQueryDigest } from "./personal-memory-permission-payload";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator";
import type { ElicitationPurposeRequest, PersonalMemoryPermissionOpenPlan, PersonalMemoryPermissionPurpose } from "../elicitation-purpose.types";

/**
 * Checks and records permission for one personal-memory invocation.
 *
 * The receipt binds the responding person, run attempt, invocation revision, query, saved input,
 * persona and expiry. Verification checks the current dispatch claim without consuming the receipt.
 * An answer of "this session" or "every time" also records a standing grant, so a later recall of
 * the same dataset is not asked again. This class never reads memory content or resumes the run.
 */
export class PrismaPersonalMemoryPermissionPurposeAuthority implements PersonalMemoryPermissionPurpose
{
	/** Ask IAM to check claims and change invocation state in this same transaction. */
	private readonly _toolInvocations: ToolInvocationElicitationRepository;
	/** Standing grants that let this gate stop asking. */
	private readonly _grants: ApprovalGrantRepository;

	/** Keep permission receipts, grants and invocation decisions in the request's transaction. */
	public constructor(private readonly _transaction: Prisma.TransactionClient)
	{
		this._toolInvocations = new PrismaToolInvocationElicitationRepository(this._transaction);
		this._grants = new PrismaApprovalGrantRepository(this._transaction);
	}

	/**
	 * Build the question for the person whose memory this invocation would use.
	 *
	 * A live grant from an earlier "this session" or "every time" answer means the person is not
	 * asked again and the run is not paused. Which scopes the question offers depends on the dataset:
	 * an ordinary dataset may be silenced for good, a sensitive one only for this conversation. A
	 * subject with no owned dataset is treated as the sensitive case, because a grant has to be keyed
	 * to a dataset and inventing one would widen the answer beyond what was shown.
	 */
	public async prepareOpen(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionOpenPlan>
	{
		const payload = _BuildMemoryPermissionPayload(invocation, snapshot);
		if (payload === null)
			return { outcome: MemoryPermissionOpenOutcomes.Refused };
		const conversationId = snapshot.conversationId as string;
		const dataset = await this._ownedDataset(invocation.siloId, payload.executionSubjectId);
		if (dataset !== null && await this._grants.findLive(this._memoryGrantCoordinates(invocation.siloId, payload.executionSubjectId, dataset.id), conversationId, now) !== null)
			return { outcome: MemoryPermissionOpenOutcomes.Covered };
		const body = {
			kind: ElicitationBodyKinds.Approval,
			prompt: "Allow this agent to use your personal memory for this answer?",
			action: "Use personal memory",
			target: "Your saved memory",
			dataUse: "Use remembered facts only for this answer",
			consequence: "The agent will answer this request using relevant saved memory",
			offeredScopes: _MemoryOfferedScopes(dataset === null || dataset.sensitive),
		} as const;
		const command = {
			requestId: `memory-permission-${invocation.id}`,
			siloId: invocation.siloId,
			conversationId,
			runId: payload.runId,
			attempt: payload.attempt,
			assignedParticipantId: payload.executionSubjectId,
			requestKey: `memory-permission:${invocation.id}`,
			purpose: ElicitationPurposes.PersonalMemoryPermission,
			body,
			purposePayload: payload as unknown as JsonValue,
			purposePayloadDigest: __DigestCanonicalJson(payload as unknown as JsonValue),
			requiresStepUp: false,
			now,
			expiresAt: new Date(payload.expiresAt),
		};
		return { outcome: MemoryPermissionOpenOutcomes.Opened, command };
	}

	/** Check that the accepted receipt, or the standing grant that replaced it, still covers this dispatch claim. */
	public async verify(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		const expectedPayload = _BuildMemoryPermissionPayloadForClaimedInvocation(invocation, snapshot);
		const executionPrincipalId = _InvocationExecutionPrincipalId(invocation);
		if (expectedPayload === null || executionPrincipalId === null || !await this._toolInvocations.verifyActiveDispatchClaim(invocation, claim, now))
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const query = { where: { toolInvocationId: invocation.id }, include: { request: true } } as const;
		const receipt = await this._transaction.personalMemoryPermissionReceipt.findUnique(query);
		if (receipt === null)
			return this._verifyByStandingGrant(invocation, executionPrincipalId, snapshot, now);
		const request = receipt.request;
		const matches = receipt.state === PersonalMemoryPermissionReceiptState.Active
			&& receipt.consumedAt === null
			&& receipt.expiresAt.getTime() > now.getTime()
			&& receipt.toolInvocationRevision + 1 === invocation.revision
			&& receipt.runId === invocation.runId
			&& receipt.attempt === invocation.attempt
			&& receipt.executionSubjectId === executionPrincipalId
			&& receipt.respondingSubjectId === executionPrincipalId
			&& receipt.queryDigest === expectedPayload.queryDigest
			&& receipt.inputSnapshotDigest === expectedPayload.inputSnapshotDigest
			&& receipt.personaRevisionId === expectedPayload.personaRevisionId
			&& request.purpose === ElicitationPurpose.PersonalMemoryPermission
			&& request.state === ElicitationRequestState.Answered
			&& request.assignedParticipantId === executionPrincipalId
			&& request.resolvedBy === executionPrincipalId
			&& request.purposePayloadDigest === receipt.purposeDigest
			&& _MemoryPurposeMatchesReceipt(request.purposePayload, receipt);
		return { outcome: matches ? PersonalMemoryPermissionVerificationOutcomes.Authorized : PersonalMemoryPermissionVerificationOutcomes.Denied };
	}

	/** Apply the person's answer to the saved recall and record permission if they approved it. */
	public async apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval)
			return false;
		const payload = _ParsePersonalMemoryPermissionPayload(request.purposePayload);
		if (payload === null || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest)
			return false;
		const invocation = await this._toolInvocations.findById(payload.toolInvocationId);
		const snapshotQuery = { where: { runId_attempt_digest: { runId: request.runId, attempt: request.attempt, digest: payload.inputSnapshotDigest } } };
		const snapshot = await this._transaction.runInputSnapshot.findUnique(snapshotQuery);
		if (invocation === null || snapshot === null)
			return false;
		const executionPrincipalId = _InvocationExecutionPrincipalId(invocation);
		if (executionPrincipalId === null)
			return false;
		const exact = invocation.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION
			&& invocation.state === ToolInvocationStates.AwaitingApproval
			&& invocation.revision === payload.toolInvocationRevision
			&& invocation.runId === request.runId
			&& invocation.attempt === request.attempt
			&& executionPrincipalId === subjectId
			&& request.assignedParticipantId === subjectId
			&& payload.executionSubjectId === subjectId
			&& payload.queryDigest === _MemoryQueryDigest(invocation.effectiveArguments as unknown as JsonValue)
			&& payload.inputSnapshotDigest === snapshot.digest
			&& payload.personaRevisionId === snapshot.personaRevisionId
			&& payload.expiresAt === request.expiresAt.toISOString()
			&& request.expiresAt.getTime() > now.getTime();
		if (!exact)
			return false;
		if (!response.approved)
			return this._toolInvocations.reject({ invocationId: invocation.id, now, failureCode: "memory_permission_declined" });
		const approval = {
			invocationId: invocation.id,
			expectedArguments: invocation.arguments,
			expectedArgumentsDigest: invocation.argumentsDigest,
			effectiveArguments: invocation.effectiveArguments,
			effectiveArgumentsDigest: invocation.effectiveArgumentsDigest,
		};
		const approved = await this._toolInvocations.approve(approval);
		if (!approved)
			return false;
		const receipt = { data: {
			requestId: request.id,
			toolInvocationId: invocation.id,
			toolInvocationRevision: payload.toolInvocationRevision + 1,
			runId: request.runId,
			attempt: request.attempt,
			executionSubjectId: subjectId,
			respondingSubjectId: subjectId,
			queryDigest: payload.queryDigest,
			inputSnapshotDigest: payload.inputSnapshotDigest,
			personaRevisionId: payload.personaRevisionId,
			purposeDigest: request.purposePayloadDigest,
			state: PersonalMemoryPermissionReceiptState.Active,
			expiresAt: request.expiresAt,
		} };
		await this._transaction.personalMemoryPermissionReceipt.create(receipt);
		await this._mintMemoryGrant(request, response, invocation.siloId, subjectId);
		return true;
	}

	/** Reject the recall whose permission question expired; a changed payload must roll back expiry. */
	public async expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
	{
		const payload = _ParsePersonalMemoryPermissionPayload(request.purposePayload);
		if (payload === null
			|| __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest
			|| payload.runId !== request.runId
			|| payload.attempt !== request.attempt
			|| payload.executionSubjectId !== request.assignedParticipantId
			|| payload.expiresAt !== request.expiresAt.toISOString())
			throw new Error("personal-memory permission expiry lost its protected payload fence");
		const invocation = await this._toolInvocations.findById(payload.toolInvocationId);
		const executionPrincipalId = invocation === null ? null : _InvocationExecutionPrincipalId(invocation);
		if (invocation === null
			|| executionPrincipalId === null
			|| invocation.id !== payload.toolInvocationId
			|| invocation.toolRevisionId !== PERSONAL_MEMORY_RECALL_TOOL_REVISION
			|| invocation.state !== ToolInvocationStates.AwaitingApproval
			|| invocation.revision !== payload.toolInvocationRevision
			|| invocation.runId !== payload.runId
			|| invocation.attempt !== payload.attempt
			|| executionPrincipalId !== payload.executionSubjectId)
			throw new Error("personal-memory permission expiry lost its invocation fence");
		if (!await this._toolInvocations.reject({ invocationId: payload.toolInvocationId, now, failureCode: "memory_permission_expired" }))
			throw new Error("personal-memory permission expiry lost its invocation fence");
	}

	/**
	 * Authorise a recall that has no receipt because a standing grant answered the question.
	 *
	 * Reached only when nothing was asked, which happens when `prepareOpen` found a live grant. There
	 * is deliberately no query digest to compare: a grant means the person agreed not to be asked about
	 * this dataset again, so binding it to one query would defeat it. What still has to hold is
	 * everything that identifies the caller: it must be the memory-recall tool, run for the subject who
	 * owns the dataset, under a grant that is still live for this conversation.
	 */
	private async _verifyByStandingGrant(invocation: ToolInvocationRecord, executionPrincipalId: string, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		if (invocation.toolRevisionId !== PERSONAL_MEMORY_RECALL_TOOL_REVISION)
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const dataset = await this._ownedDataset(invocation.siloId, executionPrincipalId);
		if (dataset === null)
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const grant = await this._grants.findLive(this._memoryGrantCoordinates(invocation.siloId, executionPrincipalId, dataset.id), snapshot.conversationId as string, now);
		return { outcome: grant === null ? PersonalMemoryPermissionVerificationOutcomes.Denied : PersonalMemoryPermissionVerificationOutcomes.Authorized };
	}

	/**
	 * Record the standing grant behind a "this session" or "every time" answer.
	 *
	 * The receipt still authorises this one recall; the grant only stops the next one asking. A
	 * missing dataset records nothing rather than failing the approval: the answer to the question the
	 * person was shown still stands, and they will simply be asked again. A session grant is confined
	 * to the conversation the request was opened in, read from the request row rather than the answer,
	 * so a client cannot widen its own grant by naming another conversation.
	 */
	private async _mintMemoryGrant(request: ElicitationPurposeRequest, response: ElicitationResponseValue, siloId: string, subjectId: string): Promise<void>
	{
		const scope = _ApprovalScopeOf(response);
		if (scope === ElicitationApprovalScopes.Once)
			return;
		const dataset = await this._ownedDataset(siloId, subjectId);
		if (dataset === null)
			return;
		const conversation = await this._transaction.elicitationRequest.findUnique({ where: { id: request.id }, select: { conversationId: true } });
		if (conversation === null)
			return;
		await this._grants.mint({ ...this._memoryGrantCoordinates(siloId, subjectId, dataset.id), scope, conversationId: conversation.conversationId, requestId: request.id, expiresAt: null });
	}

	/** Find the subject's own active memory dataset, and whether it may be silenced permanently. */
	private async _ownedDataset(siloId: string, subjectId: string): Promise<{ readonly id: string; readonly sensitive: boolean } | null>
	{
		const dataset = await this._transaction.memoryDataset.findFirst({ where: { siloId, boundaryPrincipalId: subjectId, state: MemoryDatasetState.Active }, select: { id: true, sensitivity: true } });
		if (dataset === null)
			return null;
		return { id: dataset.id, sensitive: dataset.sensitivity === MemoryDatasetSensitivity.Sensitive };
	}

	/** Grant coordinates for one subject's recall of their own dataset. */
	private _memoryGrantCoordinates(siloId: string, subjectId: string, datasetId: string): ApprovalGrantCoordinates
	{
		return { siloId, purpose: ElicitationPurposes.PersonalMemoryPermission, subjectId, resourceKind: MEMORY_DATASET_RESOURCE_KIND, resourceId: datasetId, action: MEMORY_RECALL_ACTION };
	}
}
