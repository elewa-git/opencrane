import { ___ExecutionSubjectSchema } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { _ToolInvocationClaimKindFromPersistence, _ToolInvocationRecoveryModeFromPersistence, _ToolInvocationStateFromPersistence } from "./tool-invocation-persistence-policy";
import type { ToolInvocationRow } from "./tool-invocation-persistence-mapping.types";
import type { McpTaskToolInvocationAuthorizationEvidence, ToolInvocationAuthorizationCoordinate, ToolInvocationAuthorizationEvidence, ToolInvocationRecord } from "./tool-invocation.types";

/** Prisma serializes the workload actor with this spelling; the public contract uses lowercase. */
const _PERSISTED_WORKLOAD_ACTOR_KIND = "Workload";

/** Return null when no authorization was saved; reject partial evidence or evidence for the wrong owner. */
function _authorizationEvidence(row: ToolInvocationRow): ToolInvocationAuthorizationEvidence | McpTaskToolInvocationAuthorizationEvidence | null
{
	const decisionDigests = row.authorizationDecisionDigests ?? [];
	const hasEvidence = !_isMissing(row.authorizationActorKind)
		|| !_isMissing(row.authorizationExecutionSubject)
		|| !_isMissing(row.authorizationCoordinates)
		|| decisionDigests.length > 0
		|| !_isMissing(row.authorizationAssignmentDigest)
		|| !_isMissing(row.authorizationEvidenceDigest);
	if (!hasEvidence)
		return null;
	if (_isMissing(row.authorizationCoordinates) || decisionDigests.length === 0 || _isMissing(row.authorizationEvidenceDigest))
		throw new Error(`ToolInvocation ${row.id} has incomplete authorization evidence`);
	if (row.runId === null)
	{
		if (!_isMissing(row.agentIdentityId) || !_isMissing(row.authorizationActorKind) || !_isMissing(row.authorizationExecutionSubject) || !_isMissing(row.authorizationAssignmentDigest))
			throw new Error(`ToolInvocation ${row.id} has invalid task authorization evidence`);
		return {
			principalId: row.principalId,
			coordinates: row.authorizationCoordinates as unknown as readonly ToolInvocationAuthorizationCoordinate[],
			decisionDigests: decisionDigests as `sha256:${string}`[],
			evidenceDigest: row.authorizationEvidenceDigest as `sha256:${string}`,
		};
	}
	if (_isMissing(row.agentIdentityId) || row.authorizationActorKind !== _PERSISTED_WORKLOAD_ACTOR_KIND || _isMissing(row.authorizationExecutionSubject) || _isMissing(row.authorizationAssignmentDigest))
		throw new Error(`ToolInvocation ${row.id} has incomplete authorization evidence`);
	const parsed = ___ExecutionSubjectSchema.safeParse(row.authorizationExecutionSubject);
	if (!parsed.success || parsed.data.siloId !== row.siloId || parsed.data.agentIdentityId !== row.agentIdentityId || parsed.data.principalId !== row.principalId || parsed.data.runScope.runId !== row.runId || parsed.data.runScope.attempt !== row.attempt || parsed.data.runScope.agentServiceId !== row.agentServiceId || parsed.data.runScope.agentRevisionId !== row.agentRevisionId)
		throw new Error(`ToolInvocation ${row.id} has invalid workload authorization evidence`);
	return {
		actorKind: "workload",
		executionSubject: parsed.data,
		coordinates: row.authorizationCoordinates as unknown as readonly ToolInvocationAuthorizationCoordinate[],
		decisionDigests: decisionDigests as `sha256:${string}`[],
		assignmentDigest: row.authorizationAssignmentDigest as `sha256:${string}`,
		evidenceDigest: row.authorizationEvidenceDigest as `sha256:${string}`,
	};
}

/** Returns whether a persistence field is absent from a row or an older test fixture. */
function _isMissing(value: unknown): value is null | undefined
{
	return value === null || value === undefined;
}

/** Build the public invocation record; incomplete or mismatched authorization evidence throws. */
export function _ToolInvocationRecord(row: ToolInvocationRow): ToolInvocationRecord
{
	return {
		id: row.id,
		siloId: row.siloId,
		agentRevisionId: row.agentRevisionId,
		authorizationEvidence: _authorizationEvidence(row),
		runId: row.runId,
		attempt: row.attempt,
		mcpTaskId: row.mcpTaskId,
		candidateId: row.candidateId,
		toolInvocationId: row.toolInvocationId,
		toolRevisionId: row.toolRevisionId,
		arguments: row.arguments as unknown as JsonValue,
		argumentsDigest: row.argumentsDigest,
		effectiveArguments: row.effectiveArguments as unknown as JsonValue,
		effectiveArgumentsDigest: row.effectiveArgumentsDigest,
		requestFingerprint: row.requestFingerprint,
		approvalRequired: row.approvalRequired,
		recoveryMode: _ToolInvocationRecoveryModeFromPersistence(row.recoveryMode),
		recoveryKey: row.recoveryKey,
		state: _ToolInvocationStateFromPersistence(row.state),
		preparationAttempt: row.preparationAttempt,
		retryDeadlineAt: row.retryDeadlineAt,
		nextPreparationAttemptAt: row.nextPreparationAttemptAt,
		claimAttempt: row.claimAttempt,
		claimKind: _ToolInvocationClaimKindFromPersistence(row.claimKind),
		claimFence: row.claimFence,
		claimExpiresAt: row.claimExpiresAt,
		result: row.result as unknown as JsonValue | null,
		failureCode: row.failureCode,
		revision: row.revision,
	};
}
