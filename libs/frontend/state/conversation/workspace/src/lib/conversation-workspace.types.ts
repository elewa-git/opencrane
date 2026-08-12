import { MessageContentBlockKinds, type ConversationLifecycles, type ConversationModes, type MessageRoles, type MessageSources, type MessageStates } from "@opencrane/models/conversations";

/** Route-level states rendered by the conversation workspace. */
export enum ConversationWorkspaceRouteStates
{
	/** Initial directory and list reads are active. */
	Loading = "loading",
	/** The signed-in participant can use the workspace. */
	Ready = "ready",
	/** The workspace could not be loaded without disclosing another participant's data. */
	Unavailable = "unavailable",
	/** A previously visible conversation is no longer authorized and its projection was purged. */
	AccessChanged = "access_changed"
}

/** Browser state for the immutable-mode creation command. */
export enum ConversationCreationStates
{
	/** No create request is active. */
	Idle = "idle",
	/** The exact selected mode and coordinates are being submitted. */
	Creating = "creating",
	/** The create command failed and can be tried again. */
	Failed = "failed"
}

/** Safe availability states for the signed-in participant's personal Agent. */
export enum ConversationPersonalAgentStatuses
{
	/** One personal Agent is available for a new Agent session. */
	Ready = "ready",
	/** No personal Agent can start a conversation. */
	Unavailable = "unavailable",
	/** More than one personal Agent matched, so the server refused to choose. */
	Ambiguous = "ambiguous"
}

/** Run lifecycle values returned by the signed-in user's run-status API. */
export enum ConversationRunStates
{
	/** The run was accepted but has not been queued yet. */
	Accepted = "accepted",
	/** The run is waiting for a worker. */
	Queued = "queued",
	/** A worker claim exists but execution has not started. */
	Assigned = "assigned",
	/** The run is executing. */
	Running = "running",
	/** The run is paused for participant input. */
	WaitingForInput = "waiting_for_input",
	/** An external action has an unknown outcome and the run must not be retried. */
	RecoveryRequired = "recovery_required",
	/** Cancellation is accepted while cleanup is still active. */
	Cancelling = "cancelling",
	/** The run completed successfully. */
	Completed = "completed",
	/** The run ended unsuccessfully and may be eligible for an explicit retry. */
	Failed = "failed",
	/** The run is cancelled and no more work is accepted. */
	Cancelled = "cancelled"
}

/** One privacy-safe creation choice for a human participant. */
export interface ConversationDirectoryParticipant
{
	/** Opaque membership coordinate sent back only in create commands. */
	readonly participantRef: string;
	/** Whether this coordinate represents the signed-in participant. */
	readonly isSelf: boolean;
	/** Generic label that never infers a name from the opaque coordinate. */
	readonly label: string;
}

/** The signed-in participant's sole available personal Agent. */
export interface ConversationPersonalAgent
{
	/** Opaque service coordinate sent back only in Agent-session creation. */
	readonly personalAgentRef: string;
	/** Server-approved display name. */
	readonly displayName: string;
}

/** Privacy-safe choices accepted by the new-conversation form. */
export interface ConversationCreationDirectory
{
	/** Human creation choices in stable server order. */
	readonly participants: readonly ConversationDirectoryParticipant[];
	/** Whether an Agent session can be created. */
	readonly personalAgentStatus: ConversationPersonalAgentStatuses;
	/** Available personal Agent only when the status is ready. */
	readonly personalAgent: ConversationPersonalAgent | null;
}

/** One conversation row shown in the left rail. */
export interface ConversationSummary
{
	/** Opaque conversation coordinate. */
	readonly id: string;
	/** Mode fixed when the conversation was created. */
	readonly mode: ConversationModes;
	/** Shared open or closed lifecycle. */
	readonly lifecycle: ConversationLifecycles;
	/** Opaque Agent service coordinate for Agent sessions. */
	readonly agentServiceId: string | null;
	/** Opaque participant coordinates used only for stable generic labels. */
	readonly participantRefs: readonly string[];
	/** Per-participant archive time. */
	readonly archivedAt: string | null;
	/** Latest browser-safe update time. */
	readonly updatedAt: string;
}

/** One canonical conversation message from the bounded snapshot. */
export interface ConversationMessage
{
	/** Stable message coordinate. */
	readonly id: string;
	/** Decimal timeline position; sorting does not use timestamps. */
	readonly position: string;
	/** Canonical author role. */
	readonly role: MessageRoles;
	/** Canonical message lifecycle. */
	readonly state: MessageStates;
	/** Canonical message source. */
	readonly source: MessageSources;
	/** Plain display blocks in server order. */
	readonly blocks: readonly { readonly id: string; readonly kind: string; readonly value: string }[];
	/** Run coordinate when an Agent produced or answered the message. */
	readonly runId: string | null;
	/** Opaque participant coordinate for human-authored messages. */
	readonly participantRef: string | null;
	/** Server timestamp used only for a display label. */
	readonly createdAt: string;
	/** Child Agent-session origin created by an @agent message. */
	readonly agentThread: { readonly childConversationId: string; readonly parentMessageId: string } | null;
}

/** Authorized bounded snapshot for one selected conversation. */
export interface ConversationWorkspaceDetail extends ConversationSummary
{
	/** First timeline position this participant may see. */
	readonly visibleFromPosition: string;
	/** Final visible position after removal, or null while access remains active. */
	readonly accessEndedPosition: string | null;
	/** Most recent canonical messages in timeline order. */
	readonly messages: readonly ConversationMessage[];
}

/** Signed-in user's status for one run attached to the selected conversation. */
export interface ConversationRun
{
	/** Opaque run coordinate. */
	readonly runId: string;
	/** Current fenced attempt. */
	readonly attempt: number;
	/** Canonical lifecycle. */
	readonly state: ConversationRunStates;
	/** Owning conversation coordinate, when attached to a conversation. */
	readonly conversationId: string | null;
}

/** Immutable command for a new conversation. */
export type CreateConversationCommand =
	| { readonly mode: ConversationModes.AgentSession; readonly personalAgentRef: string }
	| { readonly mode: ConversationModes.Direct; readonly participantRefs: readonly string[] }
	| { readonly mode: ConversationModes.Group; readonly participantRefs: readonly string[] };

/** One participant-admitted block frozen inside a retry-stable message command. */
export interface SubmitConversationMessageBlock
{
	/** Stable block coordinate reused during an exact retry. */
	readonly id: string;
	/** Participant input supports only plain text and durable asset references. */
	readonly kind: MessageContentBlockKinds.Text | MessageContentBlockKinds.Artifact;
	/** Plain text or an authorized ready asset coordinate. */
	readonly value: string;
}

/** Retry-stable participant message command retained until canonical reconciliation succeeds. */
export interface SubmitConversationMessageCommand
{
	/** Selected conversation that owns every referenced asset. */
	readonly conversationId: string;
	/** Client command coordinate reused only for an exact retry. */
	readonly idempotencyKey: string;
	/** Stable text and asset blocks reused byte-for-byte for an exact retry. */
	readonly blocks: readonly SubmitConversationMessageBlock[];
}

/** Exact participant-visible attempt selected for retry. */
export interface RetryConversationRunCommand
{
	/** Conversation that owns the run. */
	readonly conversationId: string;
	/** Run selected from the current projection. */
	readonly runId: string;
	/** Attempt last observed by the participant. */
	readonly expectedAttempt: number;
	/** Fresh command key retained only for this explicit submission. */
	readonly idempotencyKey: string;
}

/** Participant-scoped conversation reads and commands. */
export interface ConversationWorkspaceGateway
{
	/** Read privacy-safe choices for the create form. */
	directory(): Promise<ConversationCreationDirectory>;
	/** List the signed-in participant's current conversations. */
	list(): Promise<readonly ConversationSummary[]>;
	/** Read one authorized bounded conversation snapshot. */
	open(conversationId: string): Promise<ConversationWorkspaceDetail>;
	/** Create one conversation whose mode can never change. */
	create(command: CreateConversationCommand): Promise<ConversationWorkspaceDetail>;
	/** Submit one exact text-and-asset message through the selected conversation's mode strategy. */
	send(command: SubmitConversationMessageCommand): Promise<void>;
	/** Change only this participant's archive visibility. */
	archive(conversationId: string, archived: boolean): Promise<ConversationWorkspaceDetail>;
	/** Permanently close a conversation after server authority checks. */
	close(conversationId: string): Promise<ConversationWorkspaceDetail>;
	/** Read one signed-in user's run projection. */
	run(runId: string): Promise<ConversationRun>;
	/** Queue one instruction at the current run's safe boundary. */
	steer(runId: string, text: string): Promise<void>;
	/** Request cancellation of the exact observed attempt. */
	cancel(runId: string, expectedAttempt: number): Promise<ConversationRun>;
	/** Start a new attempt for one failed participant-visible conversation run. */
	retry(command: RetryConversationRunCommand): Promise<ConversationRun>;
}
