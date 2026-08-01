import type { ObotMcpInvocationPort } from "@opencrane/server/_infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/server/_infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/server/_infra/memory-gateway-client";
import type { IntegrationAuthorityRepository, ResolveIntegrationAssignmentResult } from "@opencrane/backend/server/gateways/integrations";

/** Safe bounded reason the integration authority can return without exposing custody material. */
export type IntegrationAssignmentUnavailableReason = Extract<ResolveIntegrationAssignmentResult, { readonly outcome: "unavailable" }>["reason"];

/**
 * Stable namespaces by which the prompt compiler selects an external-action transport.
 *
 * These values are serialized as the first segment of a tool revision. They select only a wired
 * executor after candidate admission and never authorize the candidate or its arguments.
 */
export enum ExternalActionRevisionKinds
{
	/** Revision routed through live integration custody and Obot. */
	Integration = "integration",
	/** Revision routed through an isolated sandbox Job. */
	Sandbox = "sandbox",
	/** Revision routed through the snapshot-scoped memory gateway. */
	Memory = "memory",
}

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
