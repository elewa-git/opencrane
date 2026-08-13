import type { Request } from "express";
import type { Logger } from "pino";

import type { ElicitationUnitOfWork } from "./elicitation.types.js";

/** Browser-session authority admitted to the self-only elicitation API. */
export interface SelfElicitationCaller
{
	/** Authenticated subject identifier. */
	readonly subjectId: string;
	/** Host-bound silo identifier. */
	readonly siloId: string;
	/** Verified reauthentication instant supplied by trusted middleware. */
	readonly verifiedStepUpAt: Date | null;
}

/** Dependencies of the transport-only self elicitation router. */
export interface SelfElicitationRouterDependencies
{
	/** Resolve trusted caller coordinates from the authenticated request. */
	readonly resolveCaller: (request: Request) => SelfElicitationCaller | null;
	/** Atomic request/read/response authority. */
	readonly elicitations: ElicitationUnitOfWork;
	/** Server-owned clock. */
	readonly clock: { readonly now: () => Date };
	/** Structured process logger. */
	readonly logger: Logger;
}
