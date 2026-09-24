import type { ElicitationApprovalScopes, ElicitationPurposes } from "@opencrane/contracts";

/** Coordinates identifying the one question a grant answers. */
export interface ApprovalGrantCoordinates
{
	/** Silo the grant belongs to; a grant never crosses one. */
	readonly siloId: string;
	/** Purpose whose gate minted and reads the grant. */
	readonly purpose: ElicitationPurposes;
	/** Person who answered and whom the grant stops being asked. */
	readonly subjectId: string;
	/** What the grant is about, for example a memory dataset or a tool. */
	readonly resourceKind: string;
	/** Exact resource identifier within that kind. */
	readonly resourceId: string;
	/** Operation on that resource, for example `recall`. */
	readonly action: string;
}

/** One grant to write after an answer of scope session or always. */
export interface MintApprovalGrantCommand extends ApprovalGrantCoordinates
{
	/** Chosen scope; `Once` never reaches here because it records no grant. */
	readonly scope: ElicitationApprovalScopes.Session | ElicitationApprovalScopes.Always;
	/** Conversation the session grant is confined to; null for an always grant. */
	readonly conversationId: string | null;
	/** Elicitation request the answer came from, which makes the write idempotent. */
	readonly requestId: string;
	/** Optional deadline; a grant with none lasts until it is revoked. */
	readonly expiresAt: Date | null;
}

/** One live grant found for a question. */
export interface LiveApprovalGrant
{
	/** Grant row identifier, so a caller can revoke exactly this one. */
	readonly id: string;
	/** Whether it covers this conversation only or every conversation. */
	readonly scope: ElicitationApprovalScopes.Session | ElicitationApprovalScopes.Always;
}

/** Transaction-bound authority over the standing grants that suppress a question. */
export interface ApprovalGrantRepository
{
	/** Write the grant behind one answered question, or refuse an incoherent one. */
	mint(command: MintApprovalGrantCommand): Promise<boolean>;
	/** Find a grant that still answers this question, or null when the person must be asked. */
	findLive(coordinates: ApprovalGrantCoordinates, conversationId: string, now: Date): Promise<LiveApprovalGrant | null>;
	/** Revoke one grant belonging to the asking subject so its question returns. */
	revoke(siloId: string, subjectId: string, grantId: string, now: Date): Promise<boolean>;
}
