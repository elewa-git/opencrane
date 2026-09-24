import { ElicitationPurpose, ElicitationRequestState, MemoryDatasetSensitivity, MemoryDatasetState, PersonalMemoryPermissionReceiptState, type Prisma } from "@prisma/client";

import { __DigestCanonicalJson, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationElicitationRepository, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationApprovalScopes, ElicitationBodyKinds, ElicitationPurposes, type ConversationElicitation, type ElicitationResponseValue, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { MEMORY_DATASET_RESOURCE_KIND, MEMORY_RECALL_ACTION, _ApprovalScopeOf, _MemoryOfferedScopes } from "./elicitation-approval-grant";
import type { ApprovalGrantCoordinates, ApprovalGrantRepository } from "./elicitation-approval-grant.types";
import type { ElicitationPurposeRequest } from "./elicitation-purpose-strategy.types";
import { MemoryPermissionOpenOutcomes, type OpenElicitationRequest, type PersonalMemoryPermissionOperations } from "./personal-memory-permission.types";
import { PersonalMemoryPermissionVerificationOutcomes, type OpenElicitationCommand, type PersonalMemoryPermissionVerificationResult } from "./elicitation.types";
import { _BuildMemoryPermissionPayload, _BuildMemoryPermissionPayloadForClaimedInvocation, _InvocationExecutionPrincipalId, _MemoryPurposeMatchesReceipt, _MemoryQueryDigest } from "./personal-memory-permission-payload";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator";

/*
 * Personal-memory permission, kept apart from the general elicitation repository.
 *
 * These four operations are the whole of the memory consent gate: open the question, verify the
 * accepted receipt at dispatch, mint the receipt when the answer arrives, and reject the invocation
 * when the question expires unanswered. They were split out of prisma-elicitation-unit-of-work.ts
 * because they form one subject and that file had no room left under the module-growth limit.
 */

/** Prisma authority over one execution user's personal-memory permission, bound to one transaction. */
export class PrismaPersonalMemoryPermissionAuthority implements PersonalMemoryPermissionOperations
{
	/** Exact transaction every read and write runs on. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization owner for every ToolInvocation read and lifecycle transition. */
	private readonly _toolInvocations: ToolInvocationElicitationRepository;
	/** Standing grants that let this gate stop asking. */
	private readonly _grants: ApprovalGrantRepository;
	/** Opens the participant-facing request; the elicitation repository still owns that decision. */
	private readonly _openRequest: OpenElicitationRequest;

	/** Bind every memory-permission operation to one transaction and its request opener. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: ToolInvocationElicitationRepository, grants: ApprovalGrantRepository, openRequest: OpenElicitationRequest)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
		this._grants = grants;
		this._openRequest = openRequest;
	}

	/** The subject's own memory dataset, and whether it may be silenced permanently. */
	private async _OwnedDataset(siloId: string, subjectId: string): Promise<{ readonly id: string; readonly sensitive: boolean } | null>
	{
		const dataset = await this._transaction.memoryDataset.findFirst({
			where: { siloId, boundaryPrincipalId: subjectId, state: MemoryDatasetState.Active },
			select: { id: true, sensitivity: true },
		});
		if (dataset === null)
			return null;
		return { id: dataset.id, sensitive: dataset.sensitivity === MemoryDatasetSensitivity.Sensitive };
	}

	/** Grant coordinates for one subject's recall of their own dataset. */
	private _MemoryGrantCoordinates(siloId: string, subjectId: string, datasetId: string): ApprovalGrantCoordinates
	{
		return { siloId, purpose: ElicitationPurposes.PersonalMemoryPermission, subjectId, resourceKind: MEMORY_DATASET_RESOURCE_KIND, resourceId: datasetId, action: MEMORY_RECALL_ACTION };
	}

	/**
	 * Ask the execution user for permission to recall their memory, unless they already answered.
	 *
	 * A live grant from an earlier "this session" or "every time" answer short-circuits the whole
	 * question: the person is not asked again and the run is not paused. That is the point of the grant,
	 * and it is why this returns an outcome rather than a bare boolean — "nothing was opened" means two
	 * different things depending on whether a grant covered the call or the coordinates disagreed.
	 *
	 * Which scopes the question offers depends on the dataset. An ordinary dataset may be silenced for
	 * good; a sensitive one may only be silenced for the conversation, so the person is asked again next
	 * time. A subject with no owned dataset is treated as the sensitive case, because a grant has to be
	 * keyed to a dataset and inventing one would widen the answer beyond what was shown.
	 */
	async open(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<MemoryPermissionOpenOutcomes>
	{
		const payload = _BuildMemoryPermissionPayload(invocation, snapshot);
		if (payload === null)
			return MemoryPermissionOpenOutcomes.Refused;
		const conversationId = snapshot.conversationId as string;
		const dataset = await this._OwnedDataset(invocation.siloId, payload.executionSubjectId);
		if (dataset !== null)
		{
			const grant = await this._grants.findLive(this._MemoryGrantCoordinates(invocation.siloId, payload.executionSubjectId, dataset.id), conversationId, now);
			if (grant !== null)
				return MemoryPermissionOpenOutcomes.Covered;
		}
		const body = { kind: ElicitationBodyKinds.Approval, prompt: "Allow this agent to use your personal memory for this answer?", action: "Use personal memory", target: "Your saved memory", dataUse: "Use remembered facts only for this answer", consequence: "The agent will answer this request using relevant saved memory", offeredScopes: _MemoryOfferedScopes(dataset === null || dataset.sensitive) } as const;
		const opened = await this._openRequest({
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
		});
		return opened === null ? MemoryPermissionOpenOutcomes.Refused : MemoryPermissionOpenOutcomes.Opened;
	}

	/** Verify an accepted exact receipt without consuming it or reading personal-memory content. */
	async verify(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		const expectedPayload = _BuildMemoryPermissionPayloadForClaimedInvocation(invocation, snapshot);
		const executionPrincipalId = _InvocationExecutionPrincipalId(invocation);
		if (expectedPayload === null || executionPrincipalId === null || !await this._toolInvocations.verifyActiveDispatchClaim(invocation, claim, now))
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const receipt = await this._transaction.personalMemoryPermissionReceipt.findUnique({ where: { toolInvocationId: invocation.id }, include: { request: true } });
		if (receipt === null)
			return this._VerifyByStandingGrant(invocation, executionPrincipalId, snapshot, now);
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

	/**
	 * Authorise a recall that has no receipt because a standing grant answered the question.
	 *
	 * Reached only when nothing was asked, which happens when `_OpenMemoryPermission` found a live grant.
	 * There is deliberately no digest to compare here: a grant means the person agreed not to be asked
	 * about this dataset again, so binding it to one query would defeat it. What still has to hold is
	 * everything that identifies the caller — it must be the memory-recall tool, run for the subject who
	 * owns the dataset, under a grant that is still live for this conversation.
	 */
	private async _VerifyByStandingGrant(invocation: ToolInvocationRecord, executionPrincipalId: string, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		if (invocation.toolRevisionId !== PERSONAL_MEMORY_RECALL_TOOL_REVISION)
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const dataset = await this._OwnedDataset(invocation.siloId, executionPrincipalId);
		if (dataset === null)
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const grant = await this._grants.findLive(this._MemoryGrantCoordinates(invocation.siloId, executionPrincipalId, dataset.id), snapshot.conversationId as string, now);
		return { outcome: grant === null ? PersonalMemoryPermissionVerificationOutcomes.Denied : PersonalMemoryPermissionVerificationOutcomes.Authorized };
	}

	/** Create only a one-invocation personal-memory permission receipt. */
	async apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>
	{
		if (response.kind !== ElicitationBodyKinds.Approval)
			return false;
		const payload = _ParsePersonalMemoryPermissionPayload(request.purposePayload);
		if (payload === null || __DigestCanonicalJson(request.purposePayload as JsonValue) !== request.purposePayloadDigest)
			return false;
		const invocation = await this._toolInvocations.findById(payload.toolInvocationId);
		const snapshot = await this._transaction.runInputSnapshot.findUnique({ where: { runId_attempt_digest: { runId: request.runId, attempt: request.attempt, digest: payload.inputSnapshotDigest } } });
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
		const approved = await this._toolInvocations.approve({ invocationId: invocation.id, expectedArguments: invocation.arguments, expectedArgumentsDigest: invocation.argumentsDigest, effectiveArguments: invocation.effectiveArguments, effectiveArgumentsDigest: invocation.effectiveArgumentsDigest });
		if (!approved)
			return false;
		await this._transaction.personalMemoryPermissionReceipt.create({ data: { requestId: request.id, toolInvocationId: invocation.id, toolInvocationRevision: payload.toolInvocationRevision + 1, runId: request.runId, attempt: request.attempt, executionSubjectId: subjectId, respondingSubjectId: subjectId, queryDigest: payload.queryDigest, inputSnapshotDigest: payload.inputSnapshotDigest, personaRevisionId: payload.personaRevisionId, purposeDigest: request.purposePayloadDigest, state: PersonalMemoryPermissionReceiptState.Active, expiresAt: request.expiresAt } });
		await this._MintMemoryGrant(request, response, invocation.siloId, subjectId);
		return true;
	}

	/**
	 * Record the standing grant behind a "this session" or "every time" answer.
	 *
	 * The receipt above still authorises this one recall; the grant only stops the next one asking. A
	 * missing dataset silently records nothing rather than failing the approval — the person's answer to
	 * the question they were shown still stands, they will simply be asked again.
	 *
	 * A session grant is confined to the conversation the request was opened in, read from the request
	 * row rather than the answer, so a client cannot widen its own grant by naming another conversation.
	 */
	private async _MintMemoryGrant(request: ElicitationPurposeRequest, response: ElicitationResponseValue, siloId: string, subjectId: string): Promise<void>
	{
		const scope = _ApprovalScopeOf(response);
		if (scope === ElicitationApprovalScopes.Once)
			return;
		const dataset = await this._OwnedDataset(siloId, subjectId);
		if (dataset === null)
			return;
		const conversation = await this._transaction.elicitationRequest.findUnique({ where: { id: request.id }, select: { conversationId: true } });
		if (conversation === null)
			return;
		await this._grants.mint({
			...this._MemoryGrantCoordinates(siloId, subjectId, dataset.id),
			scope,
			conversationId: conversation.conversationId,
			requestId: request.id,
			expiresAt: null,
		});
	}

	/** Reject the exact invocation named by an expiring memory permission. */
	async expire(request: ElicitationPurposeRequest, now: Date): Promise<void>
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
}
