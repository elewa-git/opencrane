import { OrganizationMembersGatewayErrorKinds } from "./organization-members-gateway.types";

/** A transport failure already reduced to a browser-safe organization-members category. */
export class OrganizationMembersGatewayError extends Error
{
	/** Allows callers to distinguish this error from an arbitrary exception. */
	public override readonly name = "OrganizationMembersGatewayError";

	/**
	 * Creates a categorized member-gateway failure without retaining response bodies or invitation tokens.
	 *
	 * @param kind - Safe category a store may translate into route or command state.
	 * @param message - Browser-safe fallback copy.
	 */
	public constructor(public readonly kind: OrganizationMembersGatewayErrorKinds, message: string)
	{
		super(message);
	}
}
