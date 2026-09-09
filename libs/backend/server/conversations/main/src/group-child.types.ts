import type { ConversationMessageAdmissionResult } from "./self-conversation-history.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

import type { GroupChildCreateCommand, GroupChildShareCommand, GroupChildView } from "@opencrane/models/conversations";
export { GroupChildStates } from "@opencrane/models/conversations";
export type { GroupChildCreateCommand, GroupChildShareCommand, GroupChildView, GroupChildOrigin } from "@opencrane/models/conversations";

/** Supplies the currently authorized company identity without borrowing the requester's authority. */
export interface GroupChildAgentCandidate
{
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentIdentityId: string;
	readonly principalId: string;
	readonly name: string;
	readonly workloadProfile: string;
	readonly profileRevisionId: string;
}

/** Binds the agent-service owner's managed resolver to the lifecycle's current transaction. */
export interface GroupChildAgentResolver<TTransaction>
{
	resolve(transaction: TTransaction, caller: ConversationCaller, agentServiceId: string): Promise<GroupChildAgentCandidate | null>;
}

/** Defines the participant-facing group child commands; runtime callers receive no parent writer. */
export interface GroupChildAuthority
{
	/**
	 * Admits a new request with the current eligible group audience, or returns its accepted retry.
	 * Retrying a UUID preserves the saved recipients, even after another member joins. Both paths
	 * require current source access; a ready child also requires current child access.
	 * @returns The creation state, or null when the source or current access is unavailable.
	 * @throws GroupChildConflictError when this caller reuses an accepted UUID with another command.
	 */
	create(caller: ConversationCaller, parentConversationId: string, command: GroupChildCreateCommand): Promise<GroupChildView | null>;
	list(caller: ConversationCaller, parentConversationId: string): Promise<readonly GroupChildView[] | null>;
	share(caller: ConversationCaller, childConversationId: string, command: GroupChildShareCommand): Promise<ConversationMessageAdmissionResult | null>;
}

/** Contains only the coordinates needed to resume an admitted durable creation command. */
export interface GroupChildTaskInput
{
	readonly siloId: string;
	readonly requestId: string;
}

/** Keeps the immutable request and its recovery state independent of an ORM client. */
export interface GroupChildRequest
{
	readonly id: string;
	readonly siloId: string;
	readonly idempotencyKey: string;
	readonly parentConversationId: string;
	readonly parentMessageId: string;
	readonly parentMessagePosition: bigint;
	readonly childConversationId: string;
	readonly computerId: string;
	readonly requestedByPrincipalId: string;
	readonly requesterSubjectId: string;
	readonly requesterIssuer: string;
	readonly requesterAuthenticatedAt: Date;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly agentIdentityId: string;
	readonly agentPrincipalId: string;
	readonly agentName: string;
	readonly profileRevisionId: string;
	/** Retains untrusted JSON until the access repository validates the frozen string audience. */
	readonly participantSubjectIds: unknown;
	readonly commandDigest: string;
	readonly state: "Pending" | "Ready" | "Unavailable";
	readonly createdAt: Date;
}

/** Defines current group-child gates in one caller-owned transaction. */
export interface GroupChildAccessPort<TTransaction>
{
	mayAccess(caller: ConversationCaller, conversationId: string): Promise<boolean>;
	mayReadOrigin(caller: ConversationCaller, parentConversationId: string, position: bigint): Promise<boolean>;
	origin(caller: ConversationCaller, conversationId: string): Promise<import("@opencrane/models/conversations").GroupChildOrigin | null>;
	audience(caller: ConversationCaller, parentId: string, position: bigint, frozen?: readonly string[]): Promise<readonly string[] | null>;
	stillAdmitted(request: GroupChildRequest, agents: GroupChildAgentResolver<TTransaction>): Promise<boolean>;
}

/** Defines creation and recovery without giving history an ORM model. */
export interface GroupChildLifecyclePort
{
	create(caller: ConversationCaller, parentId: string, command: GroupChildCreateCommand): Promise<GroupChildView | null>;
	list(caller: ConversationCaller, parentId: string): Promise<readonly GroupChildView[] | null>;
	run(input: GroupChildTaskInput, attempt?: number): Promise<void>;
}

/** Defines the human sharing operation independently from its transaction adapter. */
export interface GroupChildSharePort
{
	share(caller: ConversationCaller, childId: string, command: GroupChildShareCommand): Promise<ConversationMessageAdmissionResult | null>;
}
