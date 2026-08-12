import { __DigestCanonicalJson, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { PersonalMemoryPermissionPayload, PersonalMemoryPermissionReceiptCoordinates } from "./personal-memory-permission-payload.types.js";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator.js";

/** Keep an accepted permission useful while one authorized invocation is claimed and delivered. */
const _PERSONAL_MEMORY_PERMISSION_EXTENSION_MILLISECONDS = 10 * 60 * 1_000;

/** Derive the protected permission payload from an invocation awaiting approval. */
export function _BuildMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.AwaitingApproval) return null;
	return _BuildMemoryPermissionPayloadAtRevision(invocation, snapshot, invocation.revision);
}

/** Rebuild the original protected payload after approval and claim advanced two revisions. */
export function _BuildMemoryPermissionPayloadForClaimedInvocation(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.Claimed || invocation.revision < 2) return null;
	return _BuildMemoryPermissionPayloadAtRevision(invocation, snapshot, invocation.revision - 2);
}

/** Digest the admitted memory query without retaining its text in permission persistence. */
export function _MemoryQueryDigest(argumentsValue: JsonValue): string | null
{
	if (!_JsonRecord(argumentsValue)) return null;
	const query = argumentsValue["query"];
	return typeof query === "string" ? __DigestCanonicalJson(query) : null;
}

/** Compare the protected purpose envelope with the receipt that authorizes delivery. */
export function _MemoryPurposeMatchesReceipt(value: unknown, receipt: PersonalMemoryPermissionReceiptCoordinates): boolean
{
	const payload = _ParsePersonalMemoryPermissionPayload(value);
	return payload !== null
		&& payload.toolInvocationId === receipt.toolInvocationId
		&& payload.toolInvocationRevision + 1 === receipt.toolInvocationRevision
		&& payload.runId === receipt.runId
		&& payload.attempt === receipt.attempt
		&& payload.executionSubjectId === receipt.executionSubjectId
		&& payload.queryDigest === receipt.queryDigest
		&& payload.inputSnapshotDigest === receipt.inputSnapshotDigest
		&& payload.personaRevisionId === receipt.personaRevisionId
		&& payload.expiresAt === receipt.expiresAt.toISOString();
}

/** Bind invocation, user, query, snapshot, persona, and expiry coordinates. */
function _BuildMemoryPermissionPayloadAtRevision(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, toolInvocationRevision: number): PersonalMemoryPermissionPayload | null
{
	const queryDigest = _MemoryQueryDigest(invocation.effectiveArguments);
	if (invocation.toolRevisionId !== PERSONAL_MEMORY_RECALL_TOOL_REVISION
		|| snapshot.identitySnapshot.kind !== RunInputSnapshotIdentityKinds.User
		|| snapshot.identitySnapshot.executionSubjectId !== invocation.subjectId
		|| snapshot.runId !== invocation.runId
		|| snapshot.siloId !== invocation.siloId
		|| snapshot.agentRevisionId !== invocation.agentRevisionId
		|| snapshot.conversationId === null
		|| snapshot.conversationId.trim().length === 0
		|| snapshot.personaRevisionId === null
		|| snapshot.personaRevisionId.trim().length === 0
		|| queryDigest === null) return null;
	const expiresAt = new Date(invocation.retryDeadlineAt.getTime() + _PERSONAL_MEMORY_PERMISSION_EXTENSION_MILLISECONDS);
	return { toolInvocationId: invocation.id, toolInvocationRevision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest, inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: expiresAt.toISOString() };
}

/** Whether a JSON value is a non-array object. */
function _JsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
