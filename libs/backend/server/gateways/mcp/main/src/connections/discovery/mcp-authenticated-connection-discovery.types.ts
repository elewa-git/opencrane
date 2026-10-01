import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { McpDiscoveredTool, McpConnectionCredential, McpConnectionFailureCodes } from "@opencrane/contracts";

import type { McpConnectionRecord } from "../mcp-connection.types";

/** Outcomes returned to the durable activation workflow after one discovery attempt. */
export enum McpAuthenticatedConnectionDiscoveryOutcomes
{
	/** Discovery and the matching Ready tool revision committed together. */
	Completed = "completed",
	/** Current evidence proves this generation cannot activate. */
	DefiniteFailure = "definite-failure",
	/** A read-only transport failure may clear on a later workflow attempt. */
	Retryable = "retryable",
	/** The operation cannot prove a safe terminal result and needs manual recovery. */
	Uncertain = "uncertain",
}

/** Exact generation and ephemeral authorization supplied by the activation workflow. */
export interface McpAuthenticatedConnectionDiscoveryInput
{
	/** Saved connection generation loaded through the current activation task. */
	readonly record: McpConnectionRecord;
	/** Current server endpoint whose digest must still match the saved generation. */
	readonly endpoint: string;
	/** Credentialless marker or bearer material held only for this attempt. */
	readonly credential: McpConnectionCredential;
	/** Receipt that must still match the task saved with the connection. */
	readonly task: IWorkflowTaskReceipt;
	/** Cancels DNS, transport, and response work for this attempt. */
	readonly signal: AbortSignal;
}

/** Safe result returned to the connection activation workflow. */
export interface McpAuthenticatedConnectionDiscoveryResult
{
	/** Selects workflow completion, retry, or a saved terminal failure. */
	readonly outcome: McpAuthenticatedConnectionDiscoveryOutcomes;
	/** Ready revision created or recovered only for a completed result. */
	readonly serverRevisionId?: string;
	/** Bounded failure saved only for a definite or uncertain result. */
	readonly failureCode?: McpConnectionFailureCodes;
}

/** Performs authenticated discovery and commits its connection-bound revision. */
export interface McpAuthenticatedConnectionDiscovery
{
	/** Discover every tool page and finalize the exact active generation. */
	activate(input: McpAuthenticatedConnectionDiscoveryInput): Promise<McpAuthenticatedConnectionDiscoveryResult>;
}

/** Outcomes from the transaction that owns the connection and revision winner. */
export enum McpRemoteRevisionFinalizationOutcomes
{
	/** A new Ready revision and owner grants committed with connection activation. */
	Completed = "completed",
	/** The same discovery digest recovered its previously committed revision. */
	Replayed = "replayed",
	/** Current publication, installation, ownership, task, or authority no longer permits activation. */
	Denied = "denied",
	/** A revision exists for this generation with different discovery evidence. */
	Conflict = "conflict",
}

/** Validated discovery evidence passed into the transaction without credential material. */
export interface McpRemoteRevisionFinalizationCommand
{
	/** Connection generation whose current state and authority must be rechecked. */
	readonly record: McpConnectionRecord;
	/** Receipt that identifies the one admitted activation task. */
	readonly task: IWorkflowTaskReceipt;
	/** Protocol version accepted from the authenticated discovery response. */
	readonly protocolVersion: string;
	/** Digest of the validated `server/discover` result. */
	readonly discoveryEvidenceDigest: `sha256:${string}`;
	/** Digest of protocol evidence and every validated tool definition. */
	readonly discoveryDigest: `sha256:${string}`;
	/** Complete tool set returned before pagination ended. */
	readonly tools: readonly McpDiscoveredTool[];
}

/** Result of committing or recovering one remote server revision. */
export interface McpRemoteRevisionFinalizationResult
{
	/** Reports the durable transaction decision. */
	readonly outcome: McpRemoteRevisionFinalizationOutcomes;
	/** Created or recovered revision for completed and replayed results. */
	readonly serverRevisionId?: string;
}

/** Owns the transaction that activates one generation and its Ready tool revision. */
export interface McpRemoteRevisionFinalizer
{
	/** Recheck current authority and atomically save the discovered revision. */
	finalize(command: McpRemoteRevisionFinalizationCommand): Promise<McpRemoteRevisionFinalizationResult>;
}

/** Transaction-scoped persistence and authority for one remote revision winner. */
export interface McpRemoteRevisionFinalizationRepository
{
	/** Lock current authority coordinates, then create or recover the exact revision. */
	finalize(command: McpRemoteRevisionFinalizationCommand): Promise<McpRemoteRevisionFinalizationResult>;
}
