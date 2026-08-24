import type { DurableExecution, DurableExecutionTransaction, DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpEraProbeFailureCodes } from "./mcp-era-probe-failure";

/** MCP protocol revision accepted by OpenCrane's remote server catalogue. */
export const MCP_ERA_PROTOCOL_VERSION = "2026-07-28" as const;

/** Stable task names registered by the MCP catalogue workflow. */
export enum McpEraProbeTaskNames
{
	/** Checks one draft remote server before an administrator may approve it. */
	Probe = "mcp-era-probe.probe",
}

/** Decisions that the catalogue stores after checking a remote MCP server. */
export enum McpEraProbeDecisions
{
	/** The server announced the required protocol revision and may enter review. */
	Accepted = "accepted",
	/** The server announced another revision and cannot enter the catalogue. */
	Rejected = "rejected",
}

/** Results returned by remote MCP discovery without retaining its response body. */
export interface McpEraProbeObservation
{
	/** Protocol revision announced by the remote server. */
	readonly protocolVersion: string;
	/** SHA-256 digest of the checked discovery response. */
	readonly evidenceDigest: `sha256:${string}`;
}

/** Input for the external transport that performs MCP discovery. */
export interface McpEraProbeRequest
{
	/** HTTPS endpoint read from the stored catalogue row. */
	readonly endpoint: string;
}

/** External-I/O port that checks a remote MCP endpoint. */
export interface McpEraProbeClient
{
	/**
	 * Run MCP discovery and return the announced revision plus response digest.
	 *
	 * The adapter must resolve every connection target itself and reject loopback, private,
	 * link-local, metadata, and other non-public addresses before its one direct connection. It must
	 * reject redirects and must not trust an earlier DNS result supplied by this domain.
	 */
	probe(request: McpEraProbeRequest): Promise<McpEraProbeObservation>;
}

/** Input saved with one catalogue era-probe task. */
export interface McpEraProbeTaskInput
{
	/** Silo that owns the draft catalogue row. */
	readonly siloId: string;
	/** Stored MCP server identifier, never a caller-provided endpoint. */
	readonly serverId: string;
	/** Digest that binds the task to the registered endpoint and display fields. */
	readonly registrationDigest: string;
}

/** Result saved by the workflow after the catalogue transition commits. */
export interface McpEraProbeTaskResult
{
	/** Catalogue decision derived from the required protocol revision. */
	readonly decision: McpEraProbeDecisions;
	/** Protocol revision set when the server returned valid discovery evidence. */
	readonly protocolVersion?: string;
	/** Digest of either validated discovery evidence or one bounded terminal failure. */
	readonly evidenceDigest: `sha256:${string}`;
	/** Bounded terminal reason set only when no valid protocol version was observed. */
	readonly failureCode?: McpEraProbeFailureCodes;
}

/** Receipt returned when the registration transaction admits its task. */
export interface McpEraProbeAdmission
{
	/** Stable key that makes repeated registration admission return the same task. */
	readonly taskKey: string;
	/** Engine-neutral receipt for the admitted task. */
	readonly receipt: DurableTaskReceipt;
}

/** Transaction-bound admission and worker registration owned by the MCP domain. */
export interface McpEraProbeWorkflow
{
	/** Admit the probe task through the transaction that creates the catalogue row. */
	admit(transaction: DurableExecutionTransaction, input: McpEraProbeTaskInput): Promise<McpEraProbeAdmission>;
}

/** Dependencies used to register and run the MCP era-probe task. */
export interface McpEraProbeWorkflowOptions
{
	/** Engine-neutral durable execution supplied by server composition. */
	readonly execution: DurableExecution;
	/** Remote discovery adapter supplied by server composition. */
	readonly probe: McpEraProbeClient;
	/** MCP transaction owner used to load and update catalogue rows. */
	readonly unitOfWork: McpOperatorUnitOfWork;
}

/** Admin request that registers one remote MCP server. */
export interface McpRemoteServerRegistrationCommand
{
	/** Client-generated key that makes a retried request return the first registration. */
	readonly idempotencyKey: string;
	/** Display name that is unique inside the silo. */
	readonly name: string;
	/** Short description shown during catalogue review. */
	readonly description?: string;
	/** Public HTTPS MCP endpoint that the worker will check. */
	readonly endpoint: string;
}

/** Draft server returned after its database row and task are admitted together. */
export interface McpRemoteServerRegistration
{
	/** Stable catalogue server identifier. */
	readonly id: string;
	/** Normalized display name saved for review. */
	readonly name: string;
	/** Normalized public HTTPS endpoint saved for the worker. */
	readonly endpoint: string;
	/** Current era-probe state; a new registration always starts pending. */
	readonly eraProbeStatus: string;
}

/** Result categories for idempotent remote server registration. */
export enum McpRemoteServerRegistrationOutcomes
{
	/** The request created or returned the same draft server and task. */
	Registered = "registered",
	/** The idempotency key or server name already belongs to different input. */
	Conflict = "conflict",
}

/** Result of a remote server registration attempt. */
export type McpRemoteServerRegistrationResult =
	| { readonly outcome: McpRemoteServerRegistrationOutcomes.Registered; readonly server: McpRemoteServerRegistration }
	| { readonly outcome: McpRemoteServerRegistrationOutcomes.Conflict };
