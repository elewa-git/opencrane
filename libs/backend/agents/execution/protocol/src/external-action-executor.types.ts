import type { ObotCustodyPort } from "@opencrane/server/_infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";

/** Concrete transport ports the composition root injects into the external-action router. */
export interface ExternalActionExecutorDependencies
{
	/** Silo owning the invocation, used as remote correlation context. */
	readonly siloId: string;
	/** Subject on whose behalf the action runs. */
	readonly subjectId: string;
	/** Obot credential-custody transport backing MCP tool calls (fail-closed until verified). */
	readonly obotCustody: ObotCustodyPort;
	/** Sandbox Job transport backing sandboxed tool calls (fail-closed until verified). */
	readonly sandboxExecutor: SandboxJobExecutor;
	/** Memory-gateway transport backing memory tool calls (fail-closed until verified). */
	readonly memoryGateway: MemoryGatewayClient;
}
