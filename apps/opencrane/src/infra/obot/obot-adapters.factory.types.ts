import type { ObotCustodyPort, ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";

/** Server-owned Obot authority exposed to the process composition. */
export interface ObotAdapters
{
	/** Credential custody authority; the fail-closed unavailable adapter when Obot is not configured. */
	readonly custody: ObotCustodyPort;
	/** Server-side tool invocation authority; unavailable when Obot is not configured. */
	readonly invocation: ObotMcpInvocationPort;
	/** Abort active Obot exchanges before workers and telemetry drain during process shutdown. */
	readonly stop: () => void;
}
