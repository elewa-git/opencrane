import type { GroupChildOrigin, ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import type { ProductAuthorizationActions } from "@opencrane/models/authorization";
import type { ConversationCaller } from "./types/conversation-caller.types";
export type { InitialConversationComputerResolver } from "./agent-session-creation.types";

/** Projection-only conversation list row consumed by the workspace metadata adapter. */
export interface ConversationMetadataSummary { readonly id: string; readonly mode: ConversationModes; readonly lifecycle: ConversationLifecycles; readonly agentServiceId: string | null; readonly participantRefs: readonly string[]; readonly archivedAt: string | null; readonly readThroughPosition: string; readonly updatedAt: string; }
/** Projection detail; immutable entries are loaded only from the separate history endpoint. */
export interface ConversationMetadataDetail extends ConversationMetadataSummary { readonly visibleFromPosition: string; readonly accessEndedPosition: string | null; readonly parent: GroupChildOrigin | null; }
/** Exact history coordinates released only for current participant review access. */
export interface ConversationReviewCoordinates
{
	/** Identifies the logical computer stream. */
	readonly computerId: string;
	/** Identifies the proxied or managed agent identity stream. */
	readonly agentIdentityId: string;
	/** Identifies the immutable computer profile. */
	readonly profileRevisionId: string;
}
/** Metadata authority exposed to the authenticated browser router. */
export interface ConversationMetadataAuthority { directory(caller: ConversationCaller): Promise<unknown>; list(caller: ConversationCaller, includeArchived: boolean): Promise<readonly ConversationMetadataSummary[]>; open(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>; reviewCoordinates(caller: ConversationCaller, conversationId: string, action?: ProductAuthorizationActions): Promise<ConversationReviewCoordinates | null>; create(caller: ConversationCaller, request: unknown): Promise<ConversationMetadataDetail | null>; archive(caller: ConversationCaller, conversationId: string, archived: boolean): Promise<ConversationMetadataDetail | null>; close(caller: ConversationCaller, conversationId: string): Promise<ConversationMetadataDetail | null>; }

/** Describes the member set requested by a retryable ordinary-conversation creation command. */
export interface OrdinaryConversationCreateCommand
{
	/** Fixes whether the conversation has one peer or a group of peers. */
	readonly mode: ConversationModes.Direct | ConversationModes.Group;
	/** Lists the other members; order does not change the request. */
	readonly participantRefs: readonly string[];
	/** Identifies one creation command for the signed-in principal and silo. */
	readonly idempotencyKey: string;
}

/** Lists only company assistants whose current service and invocation authority are ready. */
export type CompanyAssistantDirectory = (caller: ConversationCaller) => Promise<readonly { readonly agentServiceId: string; readonly name: string }[]>;
