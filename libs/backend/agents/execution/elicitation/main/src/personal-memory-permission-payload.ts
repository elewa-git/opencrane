import { __DigestCanonicalJson, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { PersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.types.js";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator.js";

/** Adds fifteen minutes to the invocation retry deadline when calculating permission expiry. */
const _EXTENSION_MILLISECONDS = 10 * 60 * 1_000;

/**
 * Builds the personal-memory permission envelope for an invocation that is waiting for approval.
 *
 * The envelope retains the invocation revision and the frozen run coordinates so the later receipt
 * can be tied back to the same request. It returns `null` unless the invocation is still awaiting
 * approval; callers must then avoid opening a permission request.
 *
 * Called by: {@link PrismaElicitationRepository.openMemoryPermission}.
 * @param invocation - The protected tool invocation that may ask for personal-memory permission.
 * @param snapshot - The frozen inputs for the invocation's run attempt.
 * @returns The envelope to persist with the elicitation request, or `null` when it cannot be opened.
 */
export function _OpenPersonalMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.AwaitingApproval) return null;
	return _PayloadAtRevision(invocation, snapshot, invocation.revision);
}

/**
 * Rebuilds the permission envelope that existed before approval and dispatch claim changed its revision.
 *
 * The elicitation request records the original envelope. Approval records the next revision in the
 * receipt, and dispatch claim advances it once more. It returns `null` unless the invocation is
 * claimed with both revisions present, so the caller must deny verification rather than compare a
 * payload from another state.
 *
 * Called by: {@link PrismaElicitationRepository.verifyMemoryPermission}.
 * @param invocation - The claimed tool invocation whose earlier approval envelope is needed.
 * @param snapshot - The frozen inputs for the invocation's run attempt.
 * @returns The original envelope, or `null` when the claimed invocation has no matching history.
 */
export function _ClaimedPersonalMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.Claimed || invocation.revision < 2) return null;
	return _PayloadAtRevision(invocation, snapshot, invocation.revision - 2);
}

/**
 * Checks whether a persisted request envelope has every coordinate recorded by a permission receipt.
 *
 * A receipt is not enough on its own: verification also checks the live dispatch claim and request
 * state. A malformed envelope or any differing coordinate returns `false`, so the caller denies
 * delivery instead of treating a partial match as permission.
 *
 * Called by: {@link PrismaElicitationRepository.verifyMemoryPermission}.
 * @param value - The untrusted JSON envelope stored with the elicitation request.
 * @param receipt - The personal-memory receipt that the request must match.
 * @returns `true` when the parsed envelope and receipt have identical protected coordinates.
 */
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

/**
 * Builds a permission envelope from one invocation revision and its frozen run inputs.
 *
 * The checks keep a permission tied to the personal-memory recall tool, its execution user, and the
 * same run, conversation, persona, query, and snapshot. A failed check returns `null` so callers do
 * not persist an envelope that cannot later be verified.
 *
 * @param invocation - The invocation that supplies the tool, run, user, and deadline coordinates.
 * @param snapshot - The frozen run inputs that supply identity, conversation, persona, and digest.
 * @param toolInvocationRevision - The invocation revision that the permission envelope represents.
 * @returns A fully bound envelope, or `null` when the invocation and snapshot do not match.
 */
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

/**
 * Digests the memory-recall query without storing the query in the permission envelope.
 *
 * The digest lets request opening and receipt application compare the same effective arguments while
 * keeping the query out of permission persistence. It returns `null` when the arguments have no
 * string `query` field, and callers treat that as an invalid permission request.
 *
 * Called by: {@link _PayloadAtRevision} and {@link PrismaElicitationRepository._applyMemoryPermission}.
 * @param argumentsValue - The effective JSON arguments admitted for the tool invocation.
 * @returns The query digest, or `null` when the arguments do not contain a string query.
 */
export function _PersonalMemoryQueryDigest(argumentsValue: JsonValue): string | null
{
	if (!_JsonRecord(argumentsValue)) return null;
	const query = argumentsValue["query"];
	return typeof query === "string" ? __DigestCanonicalJson(query) : null;
}

/**
 * Checks whether a JSON value is an object with string keys rather than an array.
 *
 * @param value - The JSON value whose shape is checked.
 * @returns `true` when the value can be read as a JSON record.
 */
function _JsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
