import type { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import type { ConversationCaller } from "./types/conversation-caller.types";
export type { InitialConversationComputerResolver } from "./agent-session-creation.types";

/** Projection-only conversation list row consumed by the workspace metadata adapter. */
export interface ConversationMetadataSummary { readonly id: string; readonly mode: ConversationModes; readonly lifecycle: ConversationLifecycles; readonly agentServiceId: string | null; readonly participantRefs: readonly string[]; readonly archivedAt: string | null; readonly readThroughPosition: string; readonly updatedAt: string; }
/** Projection detail; immutable entries are loaded only from the separate history endpoint. */
export interface ConversationMetadataDetail extends ConversationMetadataSummary { readonly visibleFromPosition: string; readonly accessEndedPosition: string | null; }
/** Metadata authority exposed to the authenticated browser router. */
export interface ConversationMetadataAuthority { directory(caller: ConversationCaller): Promise<unknown>; list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationMetadataSummary[]>; open(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>; create(caller: ConversationCaller, request: unknown): Promise<ConversationMetadataDetail | null>; archive(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<ConversationMetadataDetail | null>; close(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>; }
