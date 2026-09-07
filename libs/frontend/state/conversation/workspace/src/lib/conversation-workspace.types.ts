import type { ConversationLifecycles, ConversationModes, MessageRoles } from "@opencrane/models/conversations";

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

/** One privacy-safe creation choice for a human participant. */
export interface ConversationDirectoryParticipant
{
	/** Opaque membership coordinate sent back only in create commands. */
	readonly participantRef: string;
	/** Whether this coordinate represents the signed-in participant. */
	readonly isSelf: boolean;
	/** Uses the server-selected member display name, or You for the signed-in participant. */
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

/** Authorized bounded snapshot for one selected conversation. */
export interface ConversationWorkspaceDetail extends ConversationSummary
{
	/** First timeline position this participant may see. */
	readonly visibleFromPosition: string;
	/** Final visible position after removal, or null while access remains active. */
	readonly accessEndedPosition: string | null;
}

/**
 * Describes the selected participants or personal assistant for a new conversation.
 * All creation retries retain their UUID until the server returns the conversation. A new UUID
 * starts a separate conversation with the selected assistant or members.
 * Called by: ConversationWorkspaceStore and OpenCraneConversationWorkspaceGateway.
 */
export type CreateConversationCommand =
	| { readonly mode: ConversationModes.AgentSession; readonly personalAgentRef: string; readonly idempotencyKey: string }
	| { readonly mode: ConversationModes.Direct; readonly participantRefs: readonly string[]; readonly idempotencyKey: string }
	| { readonly mode: ConversationModes.Group; readonly participantRefs: readonly string[]; readonly idempotencyKey: string };

/** Retry-stable participant message command retained until canonical reconciliation succeeds. */
export interface SubmitConversationMessageCommand
{
	/** Selected conversation that owns the new immutable history entry. */
	readonly conversationId: string;
	/** Client command coordinate reused only for an exact retry. */
	readonly idempotencyKey: string;
	/** Plain participant text stored through the server's private payload boundary. */
	readonly text: string;
	/** Whether this message starts, interrupts, or does not activate computer work. */
	readonly activation: "none" | "start" | "interrupt";
}

/** App-owned route change requested after an authoritative workspace mutation. */
export interface ConversationWorkspaceNavigationIntent
{
	/** Selected conversation, or null when no non-archived row remains. */
	readonly conversationId: string | null;
}

/** Bounded command result returned by the active conversation computer. */
export interface ConversationComputerCommandResult
{
	/** Process exit code, or null when a review limit stopped the process. */
	readonly exitCode: number | null;
	/** Stable sandbox process outcome. */
	readonly outcome: "completed" | "timed_out" | "output_limited";
	/** Combined bounded stdout and stderr. */
	readonly output: string;
	/** Whether the review surface clipped output at its release ceiling. */
	readonly truncated: boolean;
}

/** Current private Chromium target shown without exposing its debugger endpoint. */
export interface ConversationComputerBrowserTarget
{
	/** Chromium target identifier used only for display selection. */
	readonly id: string;
	/** Browser-supplied page title. */
	readonly title: string;
	/** Localhost URL opened inside the computer. */
	readonly url: string;
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
	/** Submit one exact message through the Kurrent-backed history authority. */
	send(command: SubmitConversationMessageCommand): Promise<void>;
	/** Change only this participant's archive visibility. */
	archive(conversationId: string, archived: boolean): Promise<ConversationWorkspaceDetail>;
	/** Permanently close a conversation after server authority checks. */
	close(conversationId: string): Promise<ConversationWorkspaceDetail>;
}

/**
 * Defines the browser's authenticated API boundary for reviewing an active conversation computer.
 *
 * Callers identify a conversation and public operation inputs; they never receive or submit sandbox
 * ids, Service addresses, or lease credentials. Implementations must use the generated API client so
 * the server can apply `Read` to file, diff, and target discovery and `Use` to commands, browser
 * changes, screenshots, and localhost responses. Preview responses remain text for inert rendering.
 *
 * Called by: `ConversationComputerReviewStore`. Implemented by
 * `OpenCraneConversationWorkspaceGateway`.
 */
export interface ConversationComputerReviewGateway
{
	/** Read one workspace file from the active computer. */
	readComputerFile(conversationId: string, path: string): Promise<string>;
	/** Read a git diff for one workspace path. */
	readComputerDiff(conversationId: string, path: string): Promise<ConversationComputerCommandResult>;
	/** Run one release-allowlisted argv command. */
	runComputerCommand(conversationId: string, argv: readonly string[], cwd: string): Promise<ConversationComputerCommandResult>;
	/** List private Chromium targets without releasing debugger coordinates. */
	listComputerBrowserTargets(conversationId: string): Promise<readonly ConversationComputerBrowserTarget[]>;
	/** Open one allowlisted localhost page in the private browser. */
	openComputerBrowserPage(conversationId: string, port: number, path: string): Promise<void>;
	/** Capture one PNG from an allowlisted localhost page. */
	captureComputerScreenshot(conversationId: string, port: number, path: string, width: number, height: number): Promise<Blob>;
	/** Read one allowlisted localhost preview response. */
	readComputerPreview(conversationId: string, port: number, path: string): Promise<string>;
}
