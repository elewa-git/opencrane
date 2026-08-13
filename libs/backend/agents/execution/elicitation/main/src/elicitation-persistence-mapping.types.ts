import type { ElicitationPurposes, ElicitationRequestStates } from "@opencrane/contracts";

/**
 * The stored fields `_ProjectElicitation` reads, and nothing else.
 *
 * Deliberately smaller than the `ElicitationRequest` row. Listing only these fields says which parts
 * of a request may take part in building a browser reply; `purposePayload`, `purposePayloadDigest`,
 * `bodyDigest`, `requestKey`, and `siloId` are left out because a client never sees them.
 *
 * `purpose` and `state` are the contract enums, not Prisma's: the caller converts them before
 * calling, so this type stays free of `@prisma/client`.
 */
export type ElicitationProjectionRow = {
	/** Identifier the browser sends back when answering this request. */
	readonly id: string;
	/** Conversation whose participants can see the request. */
	readonly conversationId: string;
	/** Run that is paused waiting for the answer. */
	readonly runId: string;
	/** Attempt of that run. An answer for an older attempt is refused, so the browser must send it back. */
	readonly attempt: number;
	/** The one participant allowed to answer. Nobody else in the conversation may respond in their place. */
	readonly assignedParticipantId: string;
	/** Why the server is asking, which decides what happens after an answer is accepted. Already converted out of Prisma's enum. */
	readonly purpose: ElicitationPurposes;
	/** Where the request is in its lifecycle. Already converted out of Prisma's enum. */
	readonly state: ElicitationRequestStates;
	/** The stored question, cast to `ElicitationBody` on the way out. Held as `unknown` because Prisma types a JSON column loosely. */
	readonly body: unknown;
	/** True when the answer is only accepted after a fresh OpenID Connect sign-in. */
	readonly requiresStepUp: boolean;
	/** When the server created the request, sent to the client as `requestedAt`. */
	readonly createdAt: Date;
	/** The answering deadline. Past it, the request expires and the run resumes without an answer. */
	readonly expiresAt: Date;
	/** When the request reached a final state, or null while it can still be answered. */
	readonly resolvedAt: Date | null;
	/** Short reason for a final state, chosen from a fixed set so it carries no provider text or secret. Null while open. */
	readonly safeReason: string | null;
};

/**
 * The stored fields `_ElicitationRequestMatchesOpenCommand` compares when the same request is posted
 * again.
 *
 * Wider than {@link ElicitationProjectionRow} on purpose: a replay check has to look at fields a
 * client is never shown, such as `siloId` and the two digests. The timestamps are absent for the
 * opposite reason — they are read from the server clock on each post and would differ between two
 * honest replays.
 *
 * `purpose` and `bodyKind` are typed as `string` rather than as Prisma's enums, so this module needs
 * no `@prisma/client` import. The values are the database's, and the caller converts the command's
 * contract values to match before comparing.
 */
export type ElicitationReplayRow = {
	/** Identifier the caller must reuse for the post to count as a replay. */
	readonly id: string;
	/** ClusterTenant silo that owns the request. A request from another silo can never match. */
	readonly siloId: string;
	/** Conversation whose participants can see the request. */
	readonly conversationId: string;
	/** Run that is paused waiting for the answer. */
	readonly runId: string;
	/** Attempt of that run. A later attempt asks again under its own request. */
	readonly attempt: number;
	/** The one participant allowed to answer. A replay may not reassign the ask. */
	readonly assignedParticipantId: string;
	/** Key the runtime chose for this ask, unique within the run attempt. It is what makes a repeat post findable. */
	readonly requestKey: string;
	/** Stored purpose, in the database's own values. Compared against the converted command purpose. */
	readonly purpose: string;
	/** Stored body kind, in the database's own values. Compared against the converted command body kind. */
	readonly bodyKind: string;
	/** Digest of the stored question, so a replay cannot quietly change what is being asked. */
	readonly bodyDigest: string;
	/** Digest of the protected purpose payload, so a replay cannot swap the consent coordinates behind an unchanged question. */
	readonly purposePayloadDigest: string;
	/** True when the answer is only accepted after a fresh OpenID Connect sign-in. A replay may not lower this. */
	readonly requiresStepUp: boolean;
};
