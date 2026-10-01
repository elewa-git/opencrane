import type { z } from "zod";

import type { PersonalMemoryPermissionPayloadSchema } from "./personal-memory-permission-payload.validator";

/**
 * The consent record stored on a personal-memory permission question, and what an accepted answer
 * later gets checked against.
 *
 * Read the shape from {@link PersonalMemoryPermissionPayloadSchema}, not from a second declaration
 * here. The payload is stored as JSON in `ElicitationRequest.purposePayload` and re-parsed on every
 * read, so the Zod schema is the only definition that can be enforced at runtime — inferring the type
 * from it means a field added to one and not the other cannot compile.
 *
 * Written by `_BuildMemoryPermissionPayload`, reproduced by
 * `_BuildMemoryPermissionPayloadForClaimedInvocation`, and never sent to a browser.
 */
export type PersonalMemoryPermissionPayload = z.infer<typeof PersonalMemoryPermissionPayloadSchema>;

/**
 * The parts of an accepted permission receipt that must agree with the consent record the user
 * answered.
 *
 * Field names match the `PersonalMemoryPermissionReceipt` columns, because
 * `verifyMemoryPermission` passes the Prisma row straight in. Declaring the subset here keeps
 * `_MemoryPurposeMatchesReceipt` free of a `@prisma/client` import and states plainly which columns
 * carry the consent — everything else on that row is bookkeeping.
 *
 * @see PersonalMemoryPermissionPayload for the other half of the comparison.
 */
export type PersonalMemoryPermissionReceiptCoordinates = {
	/** The one invocation this receipt was issued for. The column is unique, so no invocation gets a second receipt. */
	readonly toolInvocationId: string;
	/** Revision of that invocation when the receipt was created. It is one higher than the consent record's, because approving the invocation bumped it. */
	readonly toolInvocationRevision: number;
	/** Run the recall belongs to. */
	readonly runId: string;
	/** Attempt of that run. A retry of the run has to ask again. */
	readonly attempt: number;
	/** The user whose own memory may be read. Nobody else in the conversation can stand in for them. */
	readonly executionSubjectId: string;
	/** Digest of the query that was allowed, so a different query cannot be delivered under this receipt. */
	readonly queryDigest: string;
	/** Digest of the run's frozen inputs, so the receipt cannot be reused after the run's inputs changed. */
	readonly inputSnapshotDigest: string;
	/** Persona revision that asked. A later persona revision needs fresh consent. */
	readonly personaRevisionId: string;
	/** When the receipt stops authorising anything. Copied from the request's deadline, so both expire together. */
	readonly expiresAt: Date;
};
