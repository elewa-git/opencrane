import type { OrganizationMember, OrganizationMemberRoles } from "./directory.types";
import type { OrganizationMembershipCaller } from "./authority.types";
import type { OrganizationInvitationStatuses, OrganizationInviteRecipientValidation } from "./invitations.types";
import type { OrganizationInvitationTokenCoordinates } from "./invitation-token.types";

/** Persistence projection needed to issue a link for one invitation generation. */
export interface OrganizationInvitationRecord
{
	/** Opaque invitation row identity. */
	readonly invitationId: string;
	/** Host-selected silo that owns the row. */
	readonly siloId: string;
	/** Normalized recipient email. */
	readonly email: string;
	/** Role granted after acceptance. */
	readonly role: OrganizationMemberRoles.Admin | OrganizationMemberRoles.Member;
	/** Stored lifecycle before expiry is projected. */
	readonly status: OrganizationInvitationStatuses.Pending | OrganizationInvitationStatuses.Accepted | OrganizationInvitationStatuses.Failed;
	/** Current token generation. */
	readonly generation: number;
	/** Random value authenticated into the current token. */
	readonly nonce: string;
	/** Current generation expiry. */
	readonly expiresAt: Date;
	/** Current generation issue time. */
	readonly invitedAt: Date;
	/** Peer-visible issuer name retained for the directory. */
	readonly invitedByDisplayName: string;
}

/** Repository result for the admin directory. */
export interface OrganizationMemberDirectoryRecords
{
	/** Members already mapped to their public projection. */
	readonly members: readonly OrganizationMember[];
	/** Invitations with token coordinates kept private. */
	readonly invitations: readonly OrganizationInvitationRecord[];
	/** Total active membership count, independent of the bounded row page. */
	readonly activeCount: number;
	/** Total pending and unexpired invitation count, independent of the bounded row page. */
	readonly pendingCount: number;
}

/** Draft whose random coordinates are generated before the create transaction starts. */
export interface OrganizationInvitationDraft
{
	/** New invitation row identifier. */
	readonly invitationId: string;
	/** Normalized target email. */
	readonly email: string;
	/** Initial random token nonce. */
	readonly nonce: string;
}

/** Inputs for one standalone create transaction. */
export interface CreateStandaloneInvitationsCommand
{
	/** Verified active administrator. */
	readonly caller: OrganizationMembershipCaller;
	/** Assignable role. */
	readonly role: OrganizationMemberRoles.Admin | OrganizationMemberRoles.Member;
	/** Retry coordinate scoped to caller and silo. */
	readonly idempotencyKey: string;
	/** Digest that detects reuse with different recipients or role. */
	readonly payloadDigest: string;
	/** Pre-generated invitation rows. */
	readonly drafts: readonly OrganizationInvitationDraft[];
	/** Shared issue time for the whole batch. */
	readonly invitedAt: Date;
	/** Shared expiry for the whole batch. */
	readonly expiresAt: Date;
}

/** Result of a standalone create transaction. */
export interface CreateStandaloneInvitationsResult
{
	/** Created or recovered records. */
	readonly invitations: readonly OrganizationInvitationRecord[];
	/** Count created by this invocation, zero on an idempotent replay. */
	readonly createdCount: number;
}

/** Inputs for one standalone resend transaction. */
export interface ResendStandaloneInvitationCommand
{
	/** Verified active administrator. */
	readonly caller: OrganizationMembershipCaller;
	/** Invitation selected by the route path. */
	readonly invitationId: string;
	/** Retry coordinate that prevents a duplicate rotation. */
	readonly idempotencyKey: string;
	/** New random nonce used only when this invocation wins. */
	readonly nonce: string;
	/** New issue time. */
	readonly invitedAt: Date;
	/** New expiry. */
	readonly expiresAt: Date;
}

/** Inputs for one standalone acceptance transaction. */
export interface AcceptStandaloneInvitationCommand
{
	/** Verified caller whose email has already been required. */
	readonly caller: OrganizationMembershipCaller & { readonly verifiedEmail: string };
	/** Verified token coordinates. */
	readonly coordinates: OrganizationInvitationTokenCoordinates;
	/** Server time used for exact expiry comparison. */
	readonly acceptedAt: Date;
}

/** Standalone persistence authority for local membership and invitations. */
export interface OrganizationMemberRepository
{
	/** Reads the directory after proving the caller is an active administrator. */
	directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectoryRecords>;
	/** Validates recipients after proving the caller is an active administrator. */
	validate(caller: OrganizationMembershipCaller, emails: readonly string[], now: Date): Promise<readonly OrganizationInviteRecipientValidation[]>;
	/** Creates or recovers one idempotent invitation batch and audit entry. */
	create(command: CreateStandaloneInvitationsCommand): Promise<CreateStandaloneInvitationsResult>;
	/** Rotates or recovers one idempotent invitation generation and audit entry. */
	resend(command: ResendStandaloneInvitationCommand): Promise<OrganizationInvitationRecord>;
	/** Consumes one verified matching token and creates the local membership with its audit entry. */
	accept(command: AcceptStandaloneInvitationCommand): Promise<OrganizationMember>;
}

/** Transaction-scoped delegate owner constructed by the standalone unit of work. */
export interface OrganizationMemberTransactionRepository extends OrganizationMemberRepository
{
	/** Recovers a committed create result after a unique or serialization race. */
	recoverCreate(command: CreateStandaloneInvitationsCommand): Promise<CreateStandaloneInvitationsResult | null>;
}
