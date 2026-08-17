import type { Request } from "express";

import type { OrganizationMemberDirectory } from "./directory.types";
import type { AcceptOrganizationInvitationCommand, AcceptOrganizationInvitationResult, CreateOrganizationInvitationsCommand, CreateOrganizationInvitationsResult, OrganizationInviteValidationResult, ResendOrganizationInvitationCommand, ResendOrganizationInvitationResult, ValidateOrganizationInvitationsCommand } from "./invitations.types";

/** Verified caller facts supplied by the authenticated application boundary. */
export interface OrganizationMembershipCaller
{
	/** Host-selected silo; request bodies never provide it. */
	readonly siloId: string;
	/** Stable OpenID Connect subject; request bodies never provide it. */
	readonly subjectId: string;
	/** Normalized email only when the identity provider explicitly verified it. */
	readonly verifiedEmail: string | null;
	/** Peer-visible OIDC name, with verified email as fallback. */
	readonly displayName: string;
}

/** Maps one authenticated Express request to server-owned caller facts. */
export type OrganizationMembershipCallerResolver = (request: Request) => OrganizationMembershipCaller | null;

/**
 * Defines the complete member-directory and invitation authority used by the HTTP router.
 *
 * Implementations receive identity and silo only through {@link OrganizationMembershipCaller}; none
 * of the commands lets a browser select those facts or the deployment mode. Standalone and Fleet
 * implementations must preserve the same result and error meanings so the router never needs a
 * fallback path.
 *
 * Called by: organization-members.router.ts.
 */
export interface OrganizationMembershipAuthority
{
	/** Returns the authoritative directory for an active administrator. */
	directory(caller: OrganizationMembershipCaller): Promise<OrganizationMemberDirectory>;
	/** Validates proposed recipients without changing state. */
	validate(command: ValidateOrganizationInvitationsCommand): Promise<OrganizationInviteValidationResult>;
	/** Creates or recovers one idempotent invitation batch. */
	create(command: CreateOrganizationInvitationsCommand): Promise<CreateOrganizationInvitationsResult>;
	/** Rotates or recovers one idempotent resend generation. */
	resend(command: ResendOrganizationInvitationCommand): Promise<ResendOrganizationInvitationResult>;
	/** Consumes one token for the verified matching email. */
	accept(command: AcceptOrganizationInvitationCommand): Promise<AcceptOrganizationInvitationResult>;
}
