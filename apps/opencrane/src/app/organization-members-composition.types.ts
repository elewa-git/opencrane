import type { RequestHandler, Router } from "express";

/** Organisation-member routes plus the optional standalone current-membership gate. */
export interface OrganizationMembersComposition
{
	/** Directory, invitation, resend, and acceptance routes. */
	readonly router: Router;
	/** Standalone product-access gate; Fleet retains its remote authority path unchanged. */
	readonly productAccess: RequestHandler | null;
}
