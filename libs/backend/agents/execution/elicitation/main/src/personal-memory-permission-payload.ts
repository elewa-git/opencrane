import { __DigestCanonicalJson, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { PersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.types.js";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator.js";

/** Permission remains actionable for fifteen minutes from invocation admission. */
const _EXTENSION_MILLISECONDS = 10 * 60 * 1_000;

/** Derive the protected permission payload from an exact invocation that is awaiting approval. */
export function _OpenPersonalMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.AwaitingApproval) return null;
	return _PayloadAtRevision(invocation, snapshot, invocation.revision);
}

/** Reconstruct the original protected payload after approval and claim each advanced the revision. */
export function _ClaimedPersonalMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.Claimed || invocation.revision < 2) return null;
	return _PayloadAtRevision(invocation, snapshot, invocation.revision - 2);
}

/** Compare a protected request envelope with the receipt that may allow safe memory delivery. */
export function _PersonalMemoryPurposeMatchesReceipt(value: unknown, receipt: { readonly toolInvocationId: string; readonly toolInvocationRevision: number; readonly runId: string; readonly attempt: number; readonly executionSubjectId: string; readonly queryDigest: string; readonly inputSnapshotDigest: string; readonly personaRevisionId: string; readonly expiresAt: Date }): boolean
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

/** Bind immutable invocation, execution-user, query, snapshot, persona, and expiry coordinates. */
function _PayloadAtRevision(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, toolInvocationRevision: number): PersonalMemoryPermissionPayload | null
{
	const queryDigest = _PersonalMemoryQueryDigest(invocation.effectiveArguments);
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
	const expiresAt = new Date(invocation.retryDeadlineAt.getTime() + _EXTENSION_MILLISECONDS);
	return { toolInvocationId: invocation.id, toolInvocationRevision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest, inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: expiresAt.toISOString() };
}

/** Digest the exact admitted memory query without retaining it in permission persistence. */
export function _PersonalMemoryQueryDigest(argumentsValue: JsonValue): string | null
{
	if (!_JsonRecord(argumentsValue)) return null;
	const query = argumentsValue["query"];
	return typeof query === "string" ? __DigestCanonicalJson(query) : null;
}

/** Return whether one generic JSON value is a non-array object. */
function _JsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
