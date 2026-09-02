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

/**
 * What the workspace can truthfully show for the signed-in user's completed onboarding exchange.
 *
 * The onboarding API sends this value to the workspace adapter, which keeps the first exchange
 * separate from ordinary conversation modes. The value lives only in browser state. An unknown
 * value is rejected by the adapter instead of being treated as a successful history read.
 */
export enum ConversationOnboardingHistoryStatuses
{
	/** The completed onboarding exchange is available as a read-only transcript. */
	Ready = "ready",
	/** Onboarding is not complete, so the workspace must not invent a completed transcript. */
	NotCompleted = "not_completed",
	/** This account was completed without a saved bootstrap exchange, as with an existing-user migration. */
	NotRecorded = "not_recorded",
	/** The history read failed while the rest of the workspace remained available. */
	Unavailable = "unavailable"
}

/**
 * Carries one validated line from a completed onboarding exchange into workspace presentation.
 *
 * The adapter preserves server order and maps onboarding speaker roles into shared message roles;
 * this type deliberately omits message commands, run coordinates, and conversation-mode fields.
 */
export interface ConversationOnboardingHistoryEntry
{
	/** One-based server order retained without sorting in the browser. */
	readonly ordinal: number;
	/** Speaker role used only for presentation alignment. */
	readonly role: MessageRoles.Assistant | MessageRoles.User;
	/** Plain bounded text returned by the onboarding projection. */
	readonly text: string;
}

/**
 * Carries completed onboarding evidence into the normal workspace as read-only history.
 *
 * The workspace may select and display this projection, but it must not open a conversation stream,
 * create a run, or submit messages against its onboarding-owned identifier. The separate shape keeps
 * the one-time bootstrap exchange outside the immutable direct, group, and Agent-session modes.
 */
export interface ConversationOnboardingHistory
{
	/** Onboarding-owned conversation coordinate used only as a stable browser key. */
	readonly id: string;
	/** Server-approved persona name used for the assistant label. */
	readonly personaDisplayName: string;
	/** Server time at which the exchange started. */
	readonly startedAt: string;
	/** Server time at which onboarding was validated as complete. */
	readonly completedAt: string;
	/** Complete read-only transcript in server order. */
	readonly transcript: readonly ConversationOnboardingHistoryEntry[];
}

/**
 * Reports whether the workspace can show completed onboarding history.
 *
 * The gateway returns this independently from the conversation list so an unavailable or migrated
 * history does not make ordinary chats unavailable. `history` is present only for `Ready`; callers
 * must branch on {@link ConversationOnboardingHistoryStatuses} instead of guessing from null.
 */
export interface ConversationOnboardingHistoryProjection
{
	/** Honest availability state for the optional history panel. */
	readonly status: ConversationOnboardingHistoryStatuses;
	/** Completed transcript only when status is {@link ConversationOnboardingHistoryStatuses.Ready}. */
	readonly history: ConversationOnboardingHistory | null;
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
	/** Latest timeline position the participant has read, kept as a decimal string. */
	readonly readThroughPosition: string;
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
	/** Server completion time for `Completed`, `Failed`, or `Cancelled`; null for `Pending` or `Streaming`. */
	readonly completedAt: string | null;
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
	| { readonly requestId: string; readonly mode: ConversationModes.AgentSession; readonly personalAgentRef: string }
	| { readonly requestId: string; readonly mode: ConversationModes.Direct; readonly participantRefs: readonly string[] }
	| { readonly requestId: string; readonly mode: ConversationModes.Group; readonly participantRefs: readonly string[] };

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

/** App-owned route change requested after an authoritative workspace mutation. */
export interface ConversationWorkspaceNavigationIntent
{
	/** Selected conversation, or null when no non-archived row remains. */
	readonly conversationId: string | null;
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
}

/** Retry-stable steering command for one participant-visible run. */
export interface SubmitConversationSteeringCommand
{
	/** Run selected from the current projection. */
	readonly runId: string;
	/** Exact bounded instruction retained after an ambiguous response. */
	readonly text: string;
	/** Client command coordinate reused only for this exact instruction. */
	readonly idempotencyKey: string;
}

/** Participant-scoped conversation reads and commands. */
export interface ConversationWorkspaceGateway
{
	/** Read privacy-safe choices for the create form. */
	directory(): Promise<ConversationCreationDirectory>;
	/** List the signed-in participant's current conversations. */
	list(): Promise<readonly ConversationSummary[]>;
	/** Read the completed onboarding exchange as a separate, read-only workspace projection. */
	onboardingHistory(): Promise<ConversationOnboardingHistoryProjection>;
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
	/** Queue one retry-stable instruction at the current run's safe boundary. */
	steer(command: SubmitConversationSteeringCommand): Promise<void>;
	/** Request cancellation of the exact observed attempt. */
	cancel(runId: string, expectedAttempt: number): Promise<ConversationRun>;
	/** Start a new attempt for one failed participant-visible conversation run. */
	retry(command: RetryConversationRunCommand): Promise<ConversationRun>;
}
