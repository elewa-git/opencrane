import type { ObotMcpInvocationPort } from "@opencrane/server/_infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { IntegrationAuthorityRepository, ResolveIntegrationAssignmentResult } from "@opencrane/backend/server/gateways/integrations";

/** Stable tool-revision prefixes that select the server-owned external-action transport. */
export enum ExternalActionToolRevisionPrefixes
{
	/** Resolves the frozen revision assignment before invoking the corresponding Obot MCP tool. */
	Integration = "integration",
	/** Runs an admitted operation through the isolated sandbox Job boundary. */
	Sandbox = "sandbox",
	/** Queries only the personal memory dataset frozen into the admitted run snapshot. */
	Memory = "memory",
}

/** Parsed identity of an integration tool revision that must resolve live custody before invocation. */
export interface IntegrationToolReference
{
	/** Integration assignment selected by the immutable agent revision. */
	readonly integrationId: string;
	/** Tool name constrained by the resolved integration assignment's allow-list. */
	readonly toolName: string;
}

/** Safe bounded reason the integration authority can return without exposing custody material. */
export type IntegrationAssignmentUnavailableReason = Extract<ResolveIntegrationAssignmentResult, { readonly outcome: "unavailable" }>["reason"];

/** Concrete transport ports the composition root injects into the external-action router. */
export interface ExternalActionExecutorDependencies
{
	/** Silo owning the invocation, used as remote correlation context. */
	readonly siloId: string;
	/** Subject on whose behalf the action runs. */
	readonly subjectId: string;
	/** Gateway dataset frozen in the admitted snapshot, or null when this run cannot recall personal memory. */
	readonly cogneeDatasetId: string | null;
	/** Immutable revision whose integration assignment the action must resolve through. */
	readonly agentRevisionId: string;
	/** Credential-free authority resolving an active revision integration assignment. */
	readonly integrations: IntegrationAuthorityRepository;
	/** Obot MCP invocation transport enforcing the resolved assignment's allow-list. */
	readonly obotMcpInvocation: ObotMcpInvocationPort;
	/** Sandbox Job transport backing sandboxed tool calls (fail-closed until verified). */
	readonly sandboxExecutor: SandboxJobExecutor;
	/** Memory-gateway transport backing memory tool calls (fail-closed until verified). */
	readonly memoryGateway: MemoryGatewayClient;
}
