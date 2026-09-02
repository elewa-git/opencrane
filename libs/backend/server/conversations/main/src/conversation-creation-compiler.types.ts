import { ConversationModes } from "@opencrane/models/conversations";

import type { ConversationCaller } from "./types/conversation-caller.types";
import type { CreateConversationRequest } from "./types/conversation-request.types";

/** Holds the server-resolved references that a creation reservation may persist. */
export interface CompiledConversationCreation
{
	/** Lists the initial participants in immutable creation order. */
	readonly participantUserIds: readonly string[];
	/** Names the checked personal Agent service for an Agent session, or null otherwise. */
	readonly agentServiceId: string | null;
}

/** Resolves opaque browser references inside the transaction that checks their current authority. */
export interface ConversationCreationCompilerRepository
{
	/** Returns trusted creation coordinates, or null without distinguishing unavailable references. */
	compile(caller: ConversationCaller, request: CreateConversationRequest): Promise<CompiledConversationCreation | null>;
}

/** Opens a short serializable snapshot to resolve one browser create request. */
export interface ConversationCreationCompiler
{
	/** Resolves current memberships and the caller-owned personal Agent before history can be addressed. */
	compile(caller: ConversationCaller, request: CreateConversationRequest): Promise<CompiledConversationCreation | null>;
}

/** Returns the denial reason selected by the untrusted request mode. */
export function __ConversationCreationDenialMode(request: CreateConversationRequest): "agent" | "participants"
{
	return request.mode === ConversationModes.AgentSession ? "agent" : "participants";
}
