import type { ConversationAgentBindingAuthority } from "./conversation-agent-binding.types";
import type { ConversationCreationCompiler } from "./conversation-creation-compiler.types";
import type { HistoryAnchoredConversationCreationAuthority } from "./history-anchored-conversation-creation-authority";
import type { ConversationWriteDenial } from "./types/conversation-authority-result.types";
import type { ConversationCaller } from "./types/conversation-caller.types";
import type { CreateConversationRequest } from "./types/conversation-request.types";

/** Returns server time for immutable creation participant coordinates. */
export interface ConversationCreationClock
{
	/** Returns the instant recorded in every participant creation coordinate. */
	now(): Date;
}

/**
 * Creates the history authority for one session-derived caller.
 *
 * The factory keeps reservation recovery scoped to the authenticated caller instead of letting a
 * process-wide authority reuse another caller's authorization evidence. Called by:
 * {@link HistoryAnchoredConversationCreationService} before it resumes or reserves a command.
 */
export interface HistoryAnchoredConversationCreationAuthorityFactory
{
	/** Builds the authority whose reservation operations are bound to this authenticated caller. */
	create(caller: ConversationCaller): HistoryAnchoredConversationCreationAuthority;
}

/**
 * Supplies the ordered authority boundaries for history-anchored conversation creation.
 *
 * The service resumes an existing reservation before it reads mutable references, then uses these
 * ports to compile current access, freeze Agent facts, and write the immutable anchor. An
 * implementation must keep those responsibilities separate so no browser payload becomes history.
 */
export interface ConversationCreationAuthorityDependencies
{
	/** Resolves opaque browser references against a current serializable authority snapshot. */
	readonly compiler: ConversationCreationCompiler;
	/** Freezes Agent service, revision, profile, and AgentIdentity facts for Agent sessions. */
	readonly agentBindings: ConversationAgentBindingAuthority;
	/** Creates the caller-bound reservation, history, confirmation, and projection authority. */
	readonly history: HistoryAnchoredConversationCreationAuthorityFactory;
	/** Supplies server time for the immutable creation anchor. */
	readonly clock: ConversationCreationClock;
}

/**
 * Tells a transport whether its request produced a readable conversation projection.
 *
 * `created` supplies the projection id after the creation authority has accepted the immutable
 * anchor and its relational rebuild. `denied` preserves the existing non-disclosing reason, so a
 * transport must not infer whether a participant or AgentService exists from that result.
 */
export type ConversationCreationAuthorityResult
	= { readonly outcome: "created"; readonly conversationId: string }
	| { readonly outcome: "denied"; readonly reason: ConversationWriteDenial };

/**
 * Creates or resumes one conversation from a session-derived caller and parsed browser request.
 *
 * The implementation must recover a matching request id before it recompiles mutable participant
 * or Agent facts; otherwise a lost response could create a second anchor or strand the original.
 * Called by: {@link PrismaConversationUnitOfWork.create}.
 */
export interface ConversationCreationAuthority
{
	/**
	 * Resolves, reserves, anchors, and projects one creation request without direct relational creation.
	 * @param caller - Identifies the authenticated user whose access evidence the reservation records.
	 * @param request - Carries the parsed request id, mode, and opaque participant references.
	 * @returns `created` with a readable projection id, or `denied` without disclosing unavailable coordinates.
	 * @throws {Error} When immutable history or projection cannot confirm the admitted reservation.
	 */
	create(caller: ConversationCaller, request: CreateConversationRequest): Promise<ConversationCreationAuthorityResult>;
}
