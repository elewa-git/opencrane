import type { ObotCustodyPort } from "@opencrane/server/_infra/obot-custody";
import type { ObotMcpInvocationPort } from "@opencrane/server/_infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { IntegrationAuthorityRepository } from "@opencrane/backend/server/gateways/integrations";

/** Concrete transport ports the composition root injects into the external-action router. */
export interface ExternalActionExecutorDependencies
{
	/** Silo owning the invocation, used as remote correlation context. */
	readonly siloId: string;
	/** Subject on whose behalf the action runs. */
	readonly subjectId: string;
	/** Immutable revision whose integration assignment the action must resolve through. */
	readonly agentRevisionId: string;
	/** Credential-free authority resolving an active revision integration assignment. */
	readonly integrations: IntegrationAuthorityRepository;
	/** Obot MCP invocation transport enforcing the resolved assignment's allow-list. */
	readonly obotMcpInvocation: ObotMcpInvocationPort;
	/** Obot credential-custody transport backing MCP tool calls (fail-closed until verified). */
	readonly obotCustody: ObotCustodyPort;
	/** Sandbox Job transport backing sandboxed tool calls (fail-closed until verified). */
	readonly sandboxExecutor: SandboxJobExecutor;
	/** Memory-gateway transport backing memory tool calls (fail-closed until verified). */
	readonly memoryGateway: MemoryGatewayClient;
}
