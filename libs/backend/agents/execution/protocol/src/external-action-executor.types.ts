import type { ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import type { IntegrationAuthorityRepository, ResolveIntegrationAssignmentResult } from "@opencrane/backend/server/gateways/integrations";
import type { JsonValue } from "@opencrane/util";

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

/** Durable provider command derived only from the accepted ToolInvocation authority. */
export interface DurableExternalActionCommand
{
	/** Run that owns the provider operation. */
	readonly runId: string;
	/** Positive run attempt fixed at candidate admission. */
	readonly attempt: number;
	/** Immutable tool revision selecting the trusted adapter. */
	readonly toolRevisionId: string;
	/** Runtime-originated invocation id retained only as provider correlation. */
	readonly toolInvocationId: string;
	/** Digest of the exact canonical arguments. */
	readonly argumentsDigest: string;
	/** Canonical validated arguments admitted before runtime memory was discarded. */
	readonly arguments: JsonValue;
}

/** Deferred server-side executor for one already-authorized provider action. */
export interface ExternalActionExecutor<TResult>
{
	/** Execute exactly one routed provider operation. */
	execute(): Promise<TResult>;
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

/** Process-owned transports shared by actions while identity remains invocation-specific. */
export type ProductionExternalActionTransports = Omit<ExternalActionExecutorDependencies, "siloId" | "subjectId" | "cogneeDatasetId" | "agentRevisionId">;
