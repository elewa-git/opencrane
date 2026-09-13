import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { McpToolCallResult } from "@opencrane/contracts";

/** Current companion completion coordinates selected by the MCP authority, never by a result consumer. */
export interface McpInvocationCompletionCommand
{
	/** Current companion claim repeated by the checked terminal request. */
	readonly claimFence: string;
	/** Original companion expiry, which result capture cannot extend. */
	readonly companionNotAfterEpochMs: number;
	/** Saved execution selected by the checked request and TokenReview identity. */
	readonly executionId: string;
	/** Opaque execution reference matched by the MCP authority. */
	readonly executionReference: string;
	/** TokenReview-confirmed Pod UID. */
	readonly podUid: string;
	/** Original strict result whose wire digest remains the MCP replay identity. */
	readonly result: McpToolCallResult;
	/** Immutable server revision that owns this execution. */
	readonly serverRevisionId: string;
	/** Silo that owns the execution and invocation. */
	readonly siloId: string;
	/** Current IAM claim stored on the execution. */
	readonly toolClaim: ToolInvocationClaim;
	/** TokenReview-confirmed executor identity. */
	readonly workload: RuntimeWorkloadIdentity;
	/** Registered executor Job UID, distinct from its Pod UID. */
	readonly workloadUid: string;
}

/** Freshly loaded IAM invocation and immutable tool name passed to the result owner on this transaction. */
export interface McpInvocationResultCommand extends McpInvocationCompletionCommand
{
	/** Exact claimed invocation whose result is about to become durable. */
	readonly invocation: ToolInvocationRecord;
	/** Name read from the selected tool revision owned by the execution's server revision. */
	readonly toolName: string;
}

/** Result consumer may replace governed embedded bytes only after saving its durable custody. */
export interface McpInvocationResultParticipant
{
	/** Return the terminal-safe result or throw to roll back the whole MCP completion. */
	prepare(command: McpInvocationResultCommand): Promise<McpToolCallResult>;
}

/** Installs the result owner beside IAM on every MCP transaction. */
export interface McpInvocationResultParticipantFactory
{
	/** Bind result capture to the exact transaction used by the invocation and MCP terminal writes. */
	__ForTransaction(transaction: unknown): McpInvocationResultParticipant;
}

/** MCP-owned result completion without exposing its Prisma tables to the consumer. */
export interface McpInvocationCompletionRepository
{
	/** Return false before any capture when the saved invocation no longer matches its claim. */
	complete(command: McpInvocationCompletionCommand, now: Date): Promise<boolean>;
}
