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
	/** Queries only the server-authorised dataset set frozen into the admitted run snapshot. */
	Memory = "memory",
}

/** Snapshot memory-policy kinds that choose the only permitted memory recall transport. */
export enum FrozenMemoryScopeKinds
{
	/** A subject's own personal memory may return ordinary fact records. */
	Personal = "personal",
	/** Managed shared knowledge scopes must retain validated provenance. */
	Attached = "attached",
}

/** Complete, canonical memory dataset set frozen during run admission. */
export interface FrozenMemoryScope
{
	/** Policy kind that selects ordinary or provenance-validated recall. */
	readonly kind: FrozenMemoryScopeKinds;
	/** Gateway-native identifiers; runtime arguments cannot add or replace them. */
	readonly cogneeDatasetIds: readonly string[];
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
	/** Complete frozen memory scope, or null when this run cannot recall memory. */
	readonly frozenMemoryScope: FrozenMemoryScope | null;
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
