import type { ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";

/** Server-owned Obot authority exposed to the process composition. */
export interface ObotAdapters
{
	/** Credential custody authority; the fail-closed unavailable adapter when Obot is not configured. */
	readonly custody: ObotCustodyPort;
}
