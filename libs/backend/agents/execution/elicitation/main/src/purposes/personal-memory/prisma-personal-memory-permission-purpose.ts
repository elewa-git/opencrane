import { ElicitationPurpose, ElicitationRequestState, PersonalMemoryPermissionReceiptState, Prisma } from "@prisma/client";

import { __DigestCanonicalJson, PrismaToolInvocationElicitationRepository, ToolInvocationStates, type ToolInvocationClaim, type ToolInvocationElicitationRepository, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds, ElicitationPurposes, type ElicitationResponseValue, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { PersonalMemoryPermissionVerificationOutcomes, type OpenElicitationCommand, type PersonalMemoryPermissionVerificationResult } from "../../elicitation.types";
import { _BuildMemoryPermissionPayload, _BuildMemoryPermissionPayloadForClaimedInvocation, _InvocationExecutionPrincipalId, _MemoryPurposeMatchesReceipt, _MemoryQueryDigest } from "./personal-memory-permission-payload";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator";
import type { ElicitationPurposeRequest, PersonalMemoryPermissionPurpose } from "../elicitation-purpose.types";

/**
 * Checks and records permission for one personal-memory invocation.
 *
 * The receipt binds the responding person, run attempt, invocation revision, query, saved input,
 * persona and expiry. Verification checks the current dispatch claim without consuming the receipt.
 * This class never reads memory content, selects a dataset, or resumes the run.
 */
export class PrismaPersonalMemoryPermissionPurposeAuthority implements PersonalMemoryPermissionPurpose
{
	/** Ask IAM to check claims and change invocation state in this same transaction. */
	private readonly _toolInvocations: ToolInvocationElicitationRepository;

	/** Keep permission receipts and invocation decisions in the request's transaction. */
	public constructor(private readonly _transaction: Prisma.TransactionClient)
	{
		this._toolInvocations = new PrismaToolInvocationElicitationRepository(this._transaction);
	}

	/** Build the question for the person whose memory this invocation would use. */
	public createOpenCommand(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): OpenElicitationCommand | null
	{
		const payload = _BuildMemoryPermissionPayload(invocation, snapshot);
		if (payload === null)
			return null;
		const body = {
			kind: ElicitationBodyKinds.Approval,
			prompt: "Allow this agent to use your personal memory for this answer?",
			action: "Use personal memory",
			target: "Your saved memory",
			dataUse: "Use remembered facts only for this answer",
			consequence: "The agent will answer this request using relevant saved memory",
		} as const;
		return {
			requestId: `memory-permission-${invocation.id}`,
			siloId: invocation.siloId,
			conversationId: snapshot.conversationId as string,
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
	}

	/** Check that the accepted receipt still covers this dispatch claim without consuming it. */
	public async verify(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>
	{
		const expectedPayload = _BuildMemoryPermissionPayloadForClaimedInvocation(invocation, snapshot);
		const executionPrincipalId = _InvocationExecutionPrincipalId(invocation);
		if (expectedPayload === null || executionPrincipalId === null || !await this._toolInvocations.verifyActiveDispatchClaim(invocation, claim, now))
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
		const query = { where: { toolInvocationId: invocation.id }, include: { request: true } } as const;
		const receipt = await this._transaction.personalMemoryPermissionReceipt.findUnique(query);
		if (receipt === null)
			return { outcome: PersonalMemoryPermissionVerificationOutcomes.Denied };
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

}
