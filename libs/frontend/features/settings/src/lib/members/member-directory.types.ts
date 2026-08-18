import type { ScopeChipTones } from "@opencrane/elements/ui";

import type { OrganizationInviteCommandStates, OrganizationInviteIssue, OrganizationMemberDirectoryStates, OrganizationMemberRoles } from "@opencrane/state/organization/members";

/** Which authoritative collection owns one directory row. */
export enum MemberDirectoryRowKinds
{
	/** Row represents an existing organization membership. */
	Member = "member",
	/** Row represents a server-issued invitation. */
	Invitation = "invitation"
}

/** Tabs available in the member directory. */
export enum MemberDirectoryTabs
{
	/** Shows accepted member records. */
	Active = "active",
	/** Shows invitations that have not become member records. */
	Pending = "pending"
}

/** Presentation row shared by the active and pending directory tables. */
export interface MemberDirectoryRowView
{
	/** Stable opaque identity for Angular row tracking. */
	readonly id: string;
	/** Which authoritative collection supplied this row. */
	readonly kind: MemberDirectoryRowKinds;
	/** Initials derived from display-safe name or email. */
	readonly initials: string;
	/** Primary row label. */
	readonly name: string;
	/** Secondary email label. */
	readonly email: string;
	/** Human-readable role or invitation status. */
	readonly roleLabel: string;
	/** Semantic role/status chip tone. */
	readonly roleTone: ScopeChipTones;
	/** Additional status copy such as joined or expiry time. */
	readonly detail: string;
	/** Whether this accepted row is the signed-in caller. */
	readonly isCurrentUser: boolean;
	/** Whether the row may emit a resend intent. */
	readonly canResend: boolean;
	/** Whether this row's resend command is currently admitted. */
	readonly resending: boolean;
}

/** Complete presentation projection consumed by MembersViewComponent. */
export interface MembersViewModel
{
	/** Route read/refresh condition. */
	readonly directoryState: OrganizationMemberDirectoryStates;
	/** Server-computed active membership count. */
	readonly activeCount: number;
	/** Server-computed pending invitation count. */
	readonly pendingCount: number;
	/** Search-filtered accepted rows. */
	readonly activeRows: readonly MemberDirectoryRowView[];
	/** Search-filtered invitation rows. */
	readonly pendingRows: readonly MemberDirectoryRowView[];
	/** Current controlled search query. */
	readonly searchQuery: string;
	/** Browser-safe refresh warning for retained data. */
	readonly refreshError: string | null;
	/** Current invitation form/command lifecycle. */
	readonly inviteState: OrganizationInviteCommandStates;
	/** Per-recipient validation issues. */
	readonly inviteIssues: readonly OrganizationInviteIssue[];
	/** Browser-safe create command failure. */
	readonly inviteError: string | null;
	/** Server-authored links returned by a successful create. */
	readonly inviteLinks: readonly string[];
	/** Latest server-authored link returned by resend. */
	readonly resentInviteLink: string | null;
	/** Browser-safe resend command failure. */
	readonly resendError: string | null;
}

/** Controlled submit intent emitted by the invitation form. */
export interface MemberInviteSubmitIntent
{
	/** Free-entry recipients as currently shown in the form. */
	readonly emails: readonly string[];
	/** Assignable role chosen by the administrator. */
	readonly role: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>;
}

/** Select option shown for one assignable organization role. */
export interface MemberRoleOption
{
	/** Human-readable role label. */
	readonly label: string;
	/** Stable role value sent unchanged to the store. */
	readonly value: Exclude<OrganizationMemberRoles, OrganizationMemberRoles.Owner>;
}
