import type { ProductAuthorizationWorkloadContext, ToolInvocationClaim, ToolInvocationRequestIdentity } from "@opencrane/backend/server/iam/authorization";
import type { ToolCallLogEntry } from "@opencrane/contracts";

/**
 * Participant-history phases recorded before a terminal tool result.
 *
 * The string values are durable display state; neither phase says that a provider command was delivered or executed.
 */
export enum _ConversationToolProgressNotificationPhases
{
	/** The admitted proposal is recorded in participant history as a requested tool call. */
	Requested = "requested",
	/** The tool call is recorded as running from committed claim evidence; command release still requires the later current-authority check. */
	Running = "running",
}

/** Immutable saved-turn coordinates used after one proposal admission commits. */
export interface ConversationToolRequestedNotificationCommand
{
	/** Identifies the saved conversation-computer turn that admitted the proposal. */
	readonly bootstrapId: string;
	/** Identifies the silo that owns the conversation and run. */
	readonly siloId: string;
	/** Identifies the participant history that receives the safe phase. */
	readonly conversationId: string;
	/** Identifies the run that owns this tool invocation. */
	readonly runId: string;
	/** Identifies the immutable attempt within the owning run. */
	readonly attempt: number;
	/** Identifies the stable public tool call shared by every visible phase. */
	readonly toolInvocationId: string;
}

/** Exact committed provider claim that may become visible before its command leaves OpenCrane. */
export interface ConversationToolRunningNotificationCommand
{
	/** Identifies the claimed MCP execution row. */
	readonly executionId: string;
	/** Fences the command returned to the one claiming companion. */
	readonly companionClaimFence: string;
	/** Identifies the authorization-owned ToolInvocation row. */
	readonly invocationId: string;
	/** Identifies the silo that owns the claim and participant history. */
	readonly siloId: string;
	/** Identifies the participant history that receives the running phase. */
	readonly conversationId: string;
	/** Identifies the run that owns the committed claim. */
	readonly runId: string;
	/** Identifies the immutable attempt within the owning run. */
	readonly attempt: number;
	/** Identifies the stable public tool call shared by every participant-visible phase. */
	readonly toolInvocationId: string;
	/** Binds the invocation to the saved computer turn and accepted candidate. */
	readonly requestIdentity: ToolInvocationRequestIdentity;
	/** Carries the exact claim fence and lifecycle revision committed with the MCP claim. */
	readonly toolClaim: ToolInvocationClaim;
	/** Carries only the TokenReview-confirmed executor identity used by current dispatch admission. */
	readonly workload: ProductAuthorizationWorkloadContext;
}

/** Safe immutable facts used to stamp one requested or running participant entry. */
export interface ConversationToolProgressNotificationEvidence extends ConversationToolRequestedNotificationCommand
{
	/** Frozen model-facing tool name; it is display data and never an authority coordinate. */
	readonly toolName: string;
	/** Participant-safe tool family recorded without arguments or provider content. */
	readonly toolKind: ToolCallLogEntry["toolKind"];
	/** Preserves the proposal creation time so either producer creates the same requested intent. */
	readonly occurredAt: string;
}

/**
 * Closed in-memory result of one progress publication attempt.
 *
 * `Published` means the participant-history entry is durable or recovered; it does not prove command delivery or execution. `NoLongerVisible` means current authority failed or a later history phase suppresses this phase.
 */
export enum ConversationToolProgressNotificationOutcomes
{
	/** The phase is durable; running publication also passed its final current-claim check. Command delivery is still unconfirmed. */
	Published = "published",
	/** Lost current evidence or a later history phase suppresses publication, so callers must stop polling or releasing the command. */
	NoLongerVisible = "no_longer_visible",
}

/** Rechecks the exact admitted proposal after the publisher observes the conversation head. */
export interface ConversationToolRequestedNotificationEvidenceReader
{
	/** Return safe display facts only while the exact admitted proposal remains current. */
	readCurrent(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>;
}

/** Rechecks the exact committed run-owned provider claim and every current dispatch bound. */
export interface ConversationToolRunningNotificationEvidenceReader
{
	/** Return safe display facts only while the exact run-owned claim remains current. */
	readCurrent(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationEvidence | null>;
}

/** Reusable evidence read passed through the private checked-history publisher. */
export interface _ConversationToolProgressNotificationEvidenceRead
{
	/** Recheck the producer's current authority before one fresh append. */
	(): Promise<ConversationToolProgressNotificationEvidence | null>;
}

/** Publishes the requested phase before result polling can proceed. */
export interface ConversationToolRequestedNotificationPort
{
	/** Recover or append requested before the owning turn may poll for a result. */
	publishRequested(command: ConversationToolRequestedNotificationCommand): Promise<ConversationToolProgressNotificationOutcomes>;
}

/** Publishes the running phase and rechecks the claim before a provider command may be released. */
export interface ConversationToolRunningNotificationPort
{
	/** Recover or append requested and running, then recheck the claim before command release. */
	publishRunning(command: ConversationToolRunningNotificationCommand): Promise<ConversationToolProgressNotificationOutcomes>;
}
