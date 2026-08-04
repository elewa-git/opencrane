import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

import type { PersonalRunAdmissionPort } from "./personal-run-admission.types.js";

/** Trusted browser facts required to start a personal run. */
export interface PersonalRunAdmissionCaller
{
	/** Silo selected by the trusted request host. */
	readonly siloId: string;
	/** Subject established by the authenticated browser session. */
	readonly subjectId: string;
}

/** Exact untrusted browser body accepted before trusted caller coordinates are attached. */
export interface PersonalRunAdmissionRequestBody
{
	/** Existing conversation thread the authenticated caller wants to continue. */
	readonly threadId: string;
	/** Bounded retry key that returns the original immutable snapshot on duplicate delivery. */
	readonly requestIdempotencyKey: string;
}

/** Dependencies for the small HTTP adapter around the transport-free admission port. */
export interface PersonalRunAdmissionRouterDependencies
{
	/** Resolves only trusted browser identity and host coordinates. */
	readonly resolveCaller: (request: Request) => PersonalRunAdmissionCaller | null;
	/** Transaction-fenced domain port for immutable run admission. */
	readonly admission: PersonalRunAdmissionPort;
	/** Structured logger for unexpected persistence and composition failures. */
	readonly logger: Logger;
}
