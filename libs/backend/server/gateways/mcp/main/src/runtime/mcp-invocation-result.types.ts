import type { ToolInvocationClaim, ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import type { McpToolCallResult } from "@opencrane/contracts";

/** Common completion facts selected by MCP before any result participant may run. */
interface McpInvocationCompletionBase
{
	/** Original strict result whose wire digest remains the MCP replay identity. */
	readonly result: McpToolCallResult;
	/** Immutable server revision that owns this execution. */
	readonly serverRevisionId: string;
	/** Silo that owns the execution and invocation. */
	readonly siloId: string;
	/** Current IAM claim stored on the execution. */
	readonly toolClaim: ToolInvocationClaim;
}

/** OCI companion proof selected from its authenticated terminal request and saved execution. */
export interface McpOciInvocationCompletionCommand extends McpInvocationCompletionBase
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
	/** Remote fences never impersonate an OCI companion. */
	readonly remoteClaimFence?: never;
	/** TokenReview-confirmed executor identity. */
	readonly workload: RuntimeWorkloadIdentity;
	/** Registered executor Job UID, distinct from its Pod UID. */
	readonly workloadUid: string;
}

/** Server-mediated proof retained after one remote provider request. */
export interface McpRemoteInvocationCompletionCommand extends McpInvocationCompletionBase
{
	/** Runtime row whose remote fence authorized the provider request. */
	readonly executionId: string;
	/** Opaque remote fence saved before credential or provider access. */
	readonly remoteClaimFence: string;
	/** Original remote claim expiry, which result handling cannot extend. */
	readonly remoteNotAfterEpochMs: number;
}

/** Exact source proof and common result selected by the MCP transaction owner. */
export type McpInvocationCompletionCommand = McpOciInvocationCompletionCommand | McpRemoteInvocationCompletionCommand;

/** Freshly loaded IAM invocation and immutable tool name passed to the result owner on this transaction. */
export type McpInvocationResultCommand = McpInvocationCompletionCommand &
{
	/** Exact claimed invocation whose result is about to become durable. */
	readonly invocation: ToolInvocationRecord;
	/** Name read from the selected tool revision owned by the execution's server revision. */
	readonly toolName: string;
};

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

/** Terminal-safe result paired with the authoritative clock used for both completion writes. */
export interface McpInvocationPreparedCompletion
{
	/** Projection returned by the result participant after any governed resource capture. */
	readonly result: McpToolCallResult;
	/** Fresh database time for remote completion, or the existing companion completion clock. */
	readonly completedAt: Date;
}

/** MCP-owned result completion without exposing its Prisma tables to the consumer. */
export interface McpInvocationCompletionRepository
{
	/** Return false before any capture when the saved invocation no longer matches its claim. */
	complete(command: McpInvocationCompletionCommand, now: Date): Promise<boolean>;
	/** Return the prepared projection and shared completion clock, or null when authority refuses it. */
	completeResult(command: McpInvocationCompletionCommand, now: Date): Promise<McpInvocationPreparedCompletion | null>;
}
