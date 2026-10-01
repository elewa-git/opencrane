import type { Request } from "express";

/** Decides whether one browser request carries evidence for the selected external origin. */
export interface SameOriginBrowserRequestAuthority
{
	/** Returns true only when the request authority and browser evidence identify the same origin. */
	isSameOrigin(request: Request): boolean;
}
