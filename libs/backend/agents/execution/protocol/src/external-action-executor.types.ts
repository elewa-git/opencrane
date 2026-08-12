import type { ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";
import type { SandboxJobExecutor } from "@opencrane/backend/server/infra/sandbox-execution";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import type { IntegrationAuthorityRepository, ResolveIntegrationAssignmentResult } from "@opencrane/backend/server/gateways/integrations";
import type { JsonValue } from "@opencrane/util";

/** Short reason the integration authority returns; it never contains custody material. */
export type IntegrationAssignmentUnavailableReason = Extract<ResolveIntegrationAssignmentResult, { readonly outcome: "unavailable" }>["reason"];

/**
 * The prefix that says which transport an external action goes through.
 *
 * The value becomes the first segment of a tool revision id, so a compiled tool carries its routing
 * with it: `integration:<id>:<tool>`, `sandbox:...`, `memory:...`. It is routing only, never
 * permission - by the time the prefix is read the candidate has already been admitted, and the
 * integration path still rechecks live custody before anything is sent.
 *
 * Called by: `__CreateExternalActionExecutor` (external-action-executor.ts) matches on it, and
 * `_loadToolDefinitions` (prisma-run-input-compiler.ts) writes it into every compiled tool
 * revision.
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

/**
 * The provider command, built only from the accepted ToolInvocation row.
 *
 * By the time an action runs, the runtime that asked for it may be gone, so nothing here comes from
 * a live process: run, attempt, tool revision, arguments, and digest are all read back from the row
 * admitted earlier. That is what lets a later worker pass replay an action without anyone
 * re-proposing it.
 *
 * Called by: built by `_command` (production-external-action-adapter.ts) and consumed by the
 * integration, sandbox, and memory executors.
 */
export interface DurableExternalActionCommand
{
	/** Run that owns the provider operation. */
	readonly runId: string;
	/** Positive run attempt fixed at candidate admission. */
	readonly attempt: number;
	/** Tool revision id that decides which adapter runs. */
	readonly toolRevisionId: string;
	/** Invocation id the runtime chose; passed to the provider only for correlation. */
	readonly toolInvocationId: string;
	/** Digest of the exact canonical arguments. */
	readonly argumentsDigest: string;
	/** The arguments as validated at admission, kept in canonical form. */
	readonly arguments: JsonValue;
}

/**
 * Runs one already-authorized provider action.
 *
 * A one-method port, so authorization, transport choice, and the call itself stay separate: by the
 * time `execute` exists, every question about whether the action is allowed has been answered.
 *
 * @see __CreateExternalActionExecutor which selects the concrete one.
 */
export interface ExternalActionExecutor<TResult>
{
	/**
	 * Make the one routed provider call.
	 *
	 * @returns The provider's content, to be delivered to the run as the tool result.
	 * @throws When the transport is unavailable or the revision is not wired. Callers must let it
	 * throw rather than substitute an empty result, so the worker records a failure or an ambiguous
	 * outcome instead of telling the model the tool succeeded.
	 */
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
	/** Agent revision whose integration assignment the action must resolve. */
	readonly agentRevisionId: string;
	/** Resolves the revision's live integration assignment. It returns no credentials. */
	readonly integrations: IntegrationAuthorityRepository;
	/** Obot MCP invocation transport enforcing the resolved assignment's allow-list. */
	readonly obotMcpInvocation: ObotMcpInvocationPort;
	/** Sandbox Job transport backing sandboxed tool calls (fail-closed until verified). */
	readonly sandboxExecutor: SandboxJobExecutor;
	/** Memory-gateway transport backing memory tool calls (fail-closed until verified). */
	readonly memoryGateway: MemoryGatewayClient;
}

/** Transports shared by every action; the identity fields stay per-invocation. */
export type ProductionExternalActionTransports = Omit<ExternalActionExecutorDependencies, "siloId" | "subjectId" | "cogneeDatasetId" | "agentRevisionId">;
