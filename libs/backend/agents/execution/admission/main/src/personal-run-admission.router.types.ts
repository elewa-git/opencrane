import type { Request } from "express";
import type { Logger } from "@opencrane/observability";

import type { PersonalRunAdmissionPort } from "./personal-run-admission.types.js";

/** Trusted browser facts required to start a personal run. */
export interface PersonalRunAdmissionCaller
{
	/** Silo selected by the trusted request host. */
	readonly siloId: string;
	/** Subject established by the authenticated browser session. */
	readonly subjectId: string;
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
