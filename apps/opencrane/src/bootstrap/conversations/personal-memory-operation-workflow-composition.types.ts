import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

/** Shares the configured silo and one private gateway client with memory workflow composition. */
export interface PersonalMemoryWorkflowCompositionOptions
{
	/** Silo whose already-admitted tasks this server may execute. */
	readonly siloId: string;
	/** Process-owned client; provider credentials remain inside the private gateway. */
	readonly gateway: MemoryGatewayClient;
}
