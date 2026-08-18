import { OrganizationMembersGatewayError } from "./organization-members.errors";
import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/** Translate a safe gateway category into command copy without exposing response details. */
export function _OrganizationMembersCommandMessage(error: unknown, fallback: string): string
{
	if (!(error instanceof OrganizationMembersGatewayError)) return fallback;
	const messages: Partial<Record<OrganizationMembersGatewayErrorKinds, string>> = {
		[OrganizationMembersGatewayErrorKinds.Forbidden]: "You do not have permission to manage organization invitations.",
		[OrganizationMembersGatewayErrorKinds.Conflict]: "The invitation changed while this request was running. Refresh before trying again.",
		[OrganizationMembersGatewayErrorKinds.PaymentRequired]: "Your workspace needs an available paid seat before this invitation can be created.",
		[OrganizationMembersGatewayErrorKinds.Unavailable]: fallback
	};
	return messages[error.kind] ?? error.message ?? fallback;
}
