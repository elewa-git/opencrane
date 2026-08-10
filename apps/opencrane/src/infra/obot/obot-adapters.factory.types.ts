import type { ObotAttemptKeyIssuer, ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";

/** Composed Obot authorities shared by the public custody route and the runtime dispatch plane. */
export interface ObotAdapters
{
	/** Credential custody authority; the fail-closed unavailable adapter when Obot is not configured. */
	readonly custody: ObotCustodyPort;
	/** Attempt-scoped key issuer, or null when the deployment leaves Obot off. */
	readonly attemptKeys: ObotAttemptKeyIssuer | null;
}
