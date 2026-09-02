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

/** Creates a caller-bound history authority without exposing its reservation adapter to the transport. */
export interface HistoryAnchoredConversationCreationAuthorityFactory
{
	/** Builds the authority whose reservation operations are bound to this authenticated caller. */
	create(caller: ConversationCaller): HistoryAnchoredConversationCreationAuthority;
}

/** Holds the trusted seams needed to create a history-anchored conversation. */
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

/** Reports whether the immutable anchor and projection made one conversation available. */
export type ConversationCreationAuthorityResult
	= { readonly outcome: "created"; readonly conversationId: string }
	| { readonly outcome: "denied"; readonly reason: ConversationWriteDenial };

/** Creates one history-anchored conversation from a session-derived caller and parsed browser request. */
export interface ConversationCreationAuthority
{
	/** Resolves, reserves, anchors, and projects one creation request without direct relational creation. */
	create(caller: ConversationCaller, request: CreateConversationRequest): Promise<ConversationCreationAuthorityResult>;
}
