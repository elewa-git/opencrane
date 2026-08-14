import { __DigestCanonicalJson, ToolInvocationStates, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { PersonalMemoryPermissionPayload, PersonalMemoryPermissionReceiptCoordinates } from "./personal-memory-permission-payload.types.js";
import { _ParsePersonalMemoryPermissionPayload } from "./personal-memory-permission-payload.validator.js";

/*
 * This module builds and re-checks the consent record behind one personal-memory recall.
 *
 * When an agent run wants to read a user's own remembered facts, the `memory:recall` tool invocation
 * stops at AwaitingApproval and the user is asked to allow it. The payload built here is stored on
 * that question, in `ElicitationRequest.purposePayload`, and it is what the user's "yes" is a yes
 * *to*. So it has to pin the ask down completely: one tool invocation at one revision, one run and
 * attempt, one user as the memory owner, one query, the frozen run input, the persona that asked, and
 * one expiry. Approving it authorises a single recall matching all of those and nothing else — not
 * another query, not a later attempt, not the same query for a different user.
 *
 * What it must not carry is just as fixed. The query itself is reduced to `queryDigest`, so the text
 * the user typed is not copied into the permission row, and no remembered fact ever appears here:
 * facts are not part of the ask and are not part of the answer. The payload is also never projected
 * to a browser — `_ProjectElicitation` copies the fields of a request one by one and `purposePayload`
 * is not among them.
 *
 * Both write and read go through the same `.strict()` Zod schema, so a stored payload that has gained,
 * lost, or substituted a field fails to parse and the permission is refused rather than guessed at.
 *
 * The package README states the wider rule this follows: fact content never passes through an
 * elicitation result. See libs/backend/agents/execution/elicitation/main/README.md.
 */

/**
 * Extra time added to the invocation's retry deadline to get the permission's expiry: ten minutes.
 *
 * The invocation's own `retryDeadlineAt` only bounds how long the server keeps retrying it, which is
 * not long enough to also cover a person answering and the approved invocation then being claimed and
 * delivered. This extension covers that tail. The sum becomes the elicitation request's `expiresAt`,
 * and the accepted receipt inherits the same instant, so one number bounds both the window to answer
 * and the window in which the answer still authorises a recall.
 */
const _PERSONAL_MEMORY_PERMISSION_EXTENSION_MILLISECONDS = 10 * 60 * 1_000;

/**
 * Builds the consent record for a recall that is waiting to be allowed.
 *
 * You hit this the first time a run tries to read the user's personal memory. It refuses unless the
 * invocation is still at AwaitingApproval, because a payload built from an already-approved or failed
 * invocation would record its revision wrongly and no receipt would ever match it.
 *
 * Called by: `PrismaElicitationRepository.openMemoryPermission` in
 * prisma-elicitation-unit-of-work.ts, which turns the payload into the question shown to the user.
 *
 * @param invocation - The `memory:recall` invocation asking for permission.
 * @param snapshot - The frozen inputs of the run that made the request.
 * @returns The payload to store on the consent question, or null when this invocation and snapshot do
 * not agree on every coordinate. Null means no question is opened at all, so the recall stays blocked
 * — never treat it as "ask anyway".
 * @see PersonalMemoryPermissionPayload
 */
export function _BuildMemoryPermissionPayload(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.AwaitingApproval) return null;
	return _BuildMemoryPermissionPayloadAtRevision(invocation, snapshot, invocation.revision);
}

/**
 * Rebuilds the same consent record later, when the approved invocation is being dispatched.
 *
 * By then the invocation has moved twice: approving it bumped its revision once
 * (`markApprovedInTransaction` in prisma-tool-invocation-repository.ts) and claiming it for dispatch
 * bumped it again (`claim` in the same file). So the payload the user agreed to was written two
 * revisions back, and subtracting two reproduces it exactly. That reproduced payload is what the
 * stored receipt is checked against — get the arithmetic wrong and every valid permission is refused.
 *
 * Refuses unless the invocation is Claimed, and unless its revision is at least 2, since a lower
 * revision cannot have passed through both transitions.
 *
 * Called by: `PrismaElicitationRepository.verifyMemoryPermission` in
 * prisma-elicitation-unit-of-work.ts.
 *
 * @param invocation - The claimed `memory:recall` invocation about to be dispatched.
 * @param snapshot - The frozen inputs of its run, which must still agree with the invocation.
 * @returns The payload as it was when the user approved it, or null when this is not a claimed recall
 * whose coordinates still line up. Null denies the delivery.
 */
export function _BuildMemoryPermissionPayloadForClaimedInvocation(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot): PersonalMemoryPermissionPayload | null
{
	if (invocation.state !== ToolInvocationStates.Claimed || invocation.revision < 2) return null;
	return _BuildMemoryPermissionPayloadAtRevision(invocation, snapshot, invocation.revision - 2);
}

/**
 * Reduces the recall query to a digest, so the permission row can pin down which query was allowed
 * without storing the words.
 *
 * The user's question can contain anything they typed, and the consent record outlives the run. A
 * digest still catches a swapped query — any change to the text changes the digest and the stored
 * permission stops matching — while keeping the text itself out of the permission tables.
 *
 * Called by: `_BuildMemoryPermissionPayloadAtRevision` below, and
 * `PrismaElicitationRepository._applyMemoryPermission` in prisma-elicitation-unit-of-work.ts, which
 * recomputes it when the user answers to confirm the arguments have not changed since the ask.
 *
 * @param argumentsValue - The invocation's effective arguments, as stored JSON.
 * @returns `sha256:`-prefixed digest of the `query` argument, or null when the arguments are not an
 * object or carry no string `query`. Null refuses the permission, because an ask with no identifiable
 * query cannot be consented to.
 */
export function _MemoryQueryDigest(argumentsValue: JsonValue): string | null
{
	if (!_JsonRecord(argumentsValue)) return null;
	const query = argumentsValue["query"];
	return typeof query === "string" ? __DigestCanonicalJson(query) : null;
}

/**
 * Checks that the accepted receipt is the receipt for this exact consent record.
 *
 * The consent question and the receipt are two rows written at different moments, so before a recall
 * is delivered they have to be shown to describe one event. Every coordinate must line up, with one
 * deliberate offset: the receipt's `toolInvocationRevision` is the payload's plus one, because
 * approving the invocation bumped its revision in the same transaction that created the receipt.
 *
 * That offset is also what keeps a receipt usable once. It names a single invocation revision, and the
 * invocation's revision moves on with every later transition, so the receipt cannot line up a second
 * time. The receipt row adds two more locks the caller checks separately: `toolInvocationId` is unique,
 * so an invocation can never collect a second receipt, and the caller requires `state` Active with
 * `consumedAt` still null.
 *
 * Called by: `PrismaElicitationRepository.verifyMemoryPermission` in
 * prisma-elicitation-unit-of-work.ts, as the last of its checks.
 *
 * @param value - The stored `purposePayload` JSON, re-parsed here rather than trusted.
 * @param receipt - The receipt's coordinates. See {@link PersonalMemoryPermissionReceiptCoordinates}.
 * @returns True when the payload parses and every coordinate matches, so the recall may be delivered.
 * False when it does not — including when the payload no longer parses — and the caller denies.
 */
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

/**
 * Ties one invocation, one memory owner, one query, one frozen input, one persona, and one expiry
 * into the payload both build helpers return.
 *
 * The revision is passed in rather than read from the invocation, because the two callers reach this
 * at different points in the invocation's life and must record the revision the user's answer belongs
 * to, not the current one.
 *
 * @param invocation - The `memory:recall` invocation.
 * @param snapshot - The frozen inputs of its run.
 * @param toolInvocationRevision - The revision the consent is about.
 * @returns The payload, or null when any coordinate disagrees.
 */
function _BuildMemoryPermissionPayloadAtRevision(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, toolInvocationRevision: number): PersonalMemoryPermissionPayload | null
{
	// 1. Reduce the query first. It is the one coordinate that can be missing outright, and a recall
	// with no identifiable query must not become a consent question at all.
	const queryDigest = _MemoryQueryDigest(invocation.effectiveArguments);

	// 2. Refuse unless the invocation and the run's frozen inputs describe the same recall for the same
	// person: the declared memory tool, a user identity rather than a service one, the same subject as
	// the invocation's, and the same run, silo, and agent revision. A conversation and a persona are
	// required too, because the consent question is shown in that conversation and answered against
	// that persona. Any mismatch here would mean asking one user to consent to another user's recall.
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

	// 3. Derive the expiry from this invocation's own retry deadline plus the tail above, so the
	// permission is bounded by the invocation it belongs to. Both build helpers must land on the same
	// instant, which is why it comes from stored fields and never from the current clock.
	const expiresAt = new Date(invocation.retryDeadlineAt.getTime() + _PERSONAL_MEMORY_PERMISSION_EXTENSION_MILLISECONDS);

	// 4. Emit the payload. `queryDigest` stands in for the query text, and no remembered fact appears
	// here, so the stored consent names the recall without repeating its content.
	return { toolInvocationId: invocation.id, toolInvocationRevision, runId: invocation.runId, attempt: invocation.attempt, executionSubjectId: invocation.subjectId, queryDigest, inputSnapshotDigest: snapshot.digest, personaRevisionId: snapshot.personaRevisionId, expiresAt: expiresAt.toISOString() };
}

/**
 * Reports whether a JSON value is an object whose keys can be read.
 *
 * Both `null` and an array answer `"object"` to `typeof`, so neither check can be dropped before
 * reading `query` off the value.
 */
function _JsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue }
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
