/** Exact resource addressed by a grant, request, or short-lived action capability. */
export interface AuthorizationResourceLocator
{
	/** Stable resource-kind name from the capability catalog. */
	readonly kind: string;
	/** Stable identifier interpreted only within the declared resource kind and silo. */
	readonly id: string;
}
