/**
 * Categorizes failures that the organisation-member router may expose without leaking authority data.
 *
 * The router serializes these strings as public error codes and the browser adapter branches on them;
 * they are not persisted. A new value needs an HTTP status and client mapping, while unknown Fleet
 * operation/code combinations become `Unavailable` instead of entering this set unchecked.
 */
export enum OrganizationMembershipErrorKinds
{
	/** The verified caller is not an active owner or administrator. */
	Forbidden = "forbidden",
	/** The selected membership authority could not answer. */
	Unavailable = "unavailable",
	/** Fleet seat or payment authority refused the requested invitation operation. */
	PaymentRequired = "payment_required",
	/** A concurrent command or mismatched idempotency replay prevented the write. */
	Conflict = "conflict",
	/** The verified session email does not match the invitation recipient. */
	IdentityMismatch = "identity_mismatch",
	/** The invitation passed its expiry before acceptance. */
	Expired = "expired",
	/** The invitation was already consumed and cannot grant another membership. */
	AlreadyUsed = "already_used",
	/** The request body, token, or idempotency key is invalid. */
	Invalid = "invalid",
}

/** Error whose category is safe to expose without leaking authority details. */
export class OrganizationMembershipError extends Error
{
	/** Stable category used by HTTP and Fleet adapters. */
	readonly kind: OrganizationMembershipErrorKinds;

	/**
	 * Builds a browser-safe authority error.
	 * @param kind - Stable failure category.
	 * @param message - Non-secret explanation suitable for the API error envelope.
	 */
	constructor(kind: OrganizationMembershipErrorKinds, message: string)
	{
		super(message);
		this.kind = kind;
	}
}
