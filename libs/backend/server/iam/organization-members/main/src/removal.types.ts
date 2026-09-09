import type { OrganizationMembershipCaller } from "./authority.types";
import type { OrganizationMember } from "./directory.types";

/** Tells the settings row whether removal is currently offered. The write always rechecks authority. */
export enum OrganizationMemberRemovalStates
{
	/** The caller may request removal of this active member. */
	Available = "available",
	/** The row cannot offer removal for the supplied reason. */
	Unavailable = "unavailable",
}

/** Explains a disabled removal action in the public API; unknown reasons must fail validation. */
export enum OrganizationMemberRemovalUnavailableReasons
{
	/** The caller cannot remove their own membership. */
	Self = "self",
	/** Ownership transfer must be handled before the Owner can lose access. */
	Owner = "owner",
	/** This membership already grants no access. */
	Inactive = "inactive",
	/** The selected external authority has no qualified removal operation. */
	AuthorityUnsupported = "authority_unsupported",
	/** The caller lacks current membership or administration permission. */
	NotAuthorized = "not_authorized",
}

/** Carries a server-authored action state without granting permission to the browser. */
export type OrganizationMemberRemovalCapability =
	| { readonly state: OrganizationMemberRemovalStates.Available }
	| { readonly state: OrganizationMemberRemovalStates.Unavailable; readonly reason: OrganizationMemberRemovalUnavailableReasons };

/** Selects a member by opaque row identity; the authenticated boundary supplies caller and silo. */
export interface RemoveOrganizationMemberCommand
{
	/** Identifies the current authenticated actor. */
	readonly caller: OrganizationMembershipCaller;
	/** Selects the same-silo membership whose access should end. */
	readonly membershipId: string;
}

/** Returns the suspended row after removal or an authorized retry of that removal. */
export interface RemoveOrganizationMemberResult
{
	/** Describes the recorded membership without creating a replacement identity. */
	readonly member: OrganizationMember;
}

/** Supplies the removal transaction with the server time used for admission and audit. */
export interface RemoveStandaloneMemberCommand extends RemoveOrganizationMemberCommand
{
	/** Records when the authority received this removal request. */
	readonly removedAt: Date;
}
