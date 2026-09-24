import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { ConversationElicitation, ElicitationResponseValue, RunInputSnapshot } from "@opencrane/contracts";

import type { ElicitationPurposeRequest } from "./elicitation-purpose-strategy.types";
import type { OpenElicitationCommand, PersonalMemoryPermissionVerificationResult } from "./elicitation.types";

/** Opens or replays the participant-facing request, owned by the elicitation repository. */
export type OpenElicitationRequest = (command: OpenElicitationCommand) => Promise<ConversationElicitation | null>;

/** What happened when a recall asked for permission. */
export enum MemoryPermissionOpenOutcomes
{
	/** A question was opened and the run waits for the person to answer it. */
	Opened = "opened",
	/** A standing grant already answers this question, so nothing was asked. */
	Covered = "covered",
	/** The invocation and snapshot did not agree, so nothing was opened and the recall stays blocked. */
	Refused = "refused",
}

/**
 * The whole personal-memory consent gate, bound to one transaction.
 *
 * Four operations, in the order one recall meets them: ask (or find the question already answered by
 * a standing grant), verify at dispatch, record the answer, and reject the invocation when the
 * question expires unanswered.
 */
export interface PersonalMemoryPermissionOperations
{
	/** Ask for permission, or report that a standing grant already answered. */
	open(invocation: ToolInvocationRecord, snapshot: RunInputSnapshot, now: Date): Promise<MemoryPermissionOpenOutcomes>;
	/** Check the accepted receipt, or the standing grant that replaced it, without consuming either. */
	verify(invocation: ToolInvocationRecord, claim: ToolInvocationClaim, snapshot: RunInputSnapshot, now: Date): Promise<PersonalMemoryPermissionVerificationResult>;
	/** Record one attributed answer: the receipt, and any grant its scope asked for. */
	apply(request: ElicitationPurposeRequest, response: ElicitationResponseValue, subjectId: string, now: Date): Promise<boolean>;
	/** Reject the exact invocation named by an expiring permission. */
	expire(request: ElicitationPurposeRequest, now: Date): Promise<void>;
}
