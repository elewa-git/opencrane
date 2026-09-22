import { ___ExecutionSubjectSchema, type ExecutionSubject } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";
import { __DigestCanonicalJson } from "../authority/canonical-json-digest";
import type { ToolInvocationRecord } from "../tool-invocations/tool-invocation.types";
import type { ApprovalElicitationBinding, ApprovalRequestBinding, ApprovalRunBinding } from "./deferred-tool-approval-binding.types";

/**
 * Return the frozen execution subject only when the run and invocation describe the same work.
 * The requester remains separate from a managed assistant's execution principal. This check
 * establishes the saved binding; current membership and permissions are checked by the caller.
 */
export function _ApprovalExecutionSubject(run: ApprovalRunBinding | null, invocation: ToolInvocationRecord | null): ExecutionSubject | null
{
	if (run === null || invocation === null || run.conversationId === null || invocation.authorizationEvidence === null || !("executionSubject" in invocation.authorizationEvidence))
		return null;
	const parsed = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
	const saved = ___ExecutionSubjectSchema.safeParse(invocation.authorizationEvidence.executionSubject);
	if (!parsed.success || !saved.success)
		return null;
	const subject = parsed.data;
	if (subject.siloId !== run.siloId || subject.principalId !== run.principalId || subject.agentIdentityId !== run.agentIdentityId
		|| subject.runScope.runId !== run.id || subject.runScope.attempt !== run.attempt
		|| subject.runScope.agentServiceId !== run.agentServiceId || subject.runScope.agentRevisionId !== run.agentRevisionId
		|| invocation.siloId !== run.siloId || invocation.runId !== run.id || invocation.attempt !== run.attempt || invocation.agentRevisionId !== run.agentRevisionId
		|| __DigestCanonicalJson(subject as unknown as JsonValue) !== __DigestCanonicalJson(saved.data as unknown as JsonValue))
		return null;
	return subject;
}

/** Verify the immutable request binding after the persistence owner checks its tool-approval purpose and body kind. */
export function _MatchesApprovalElicitation(approval: ApprovalRequestBinding, request: ApprovalElicitationBinding | null, run: ApprovalRunBinding, subjectId: string, isToolApproval: boolean): boolean
{
	const payload = { approvalRequestId: approval.id };
	return isToolApproval && request !== null && approval.elicitationRequestId === request.id
		&& approval.siloId === run.siloId && approval.runId === run.id && approval.attempt === run.attempt
		&& request.siloId === approval.siloId && request.conversationId === run.conversationId
		&& request.runId === approval.runId && request.attempt === approval.attempt
		&& request.assignedParticipantId === subjectId && request.requestKey === approval.actionDigest
		&& request.requiresStepUp
		&& request.expiresAt.getTime() === approval.expiresAt.getTime()
		&& request.purposePayloadDigest === __DigestCanonicalJson(payload)
		&& __DigestCanonicalJson(request.purposePayload as JsonValue) === __DigestCanonicalJson(payload);
}
