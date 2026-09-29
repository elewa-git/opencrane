import type { RequestRoutineProposalPort, RequestRoutineProposalSource, RequestRoutineSuggestion } from "@opencrane/backend/server/agents/scheduling/contract";

import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/** Server-owned source resolver for one frozen first-party selection. */
export interface ConversationRequestRoutineSourceResolver
{
	/** Returns the exact interactive requester source or null when current authority no longer permits it. */
	resolve(turn: FrozenConversationComputerTurn, ordinal: number): Promise<RequestRoutineProposalSource | null>;
}

/** Content-free coordinates published after scheduling has durably saved the proposal. */
export interface ConversationRoutineProposalNotificationCommand extends RequestRoutineProposalSource
{
	readonly bootstrapId: string;
	readonly proposalRef: string;
	readonly expiresAt: string;
}

/** Closed notification outcome; suppression never revives proposal authority. */
export enum ConversationRoutineProposalNotificationOutcomes
{
	Published = "published",
	NoLongerVisible = "no_longer_visible",
}

/** Dedicated requester-only routine proposal notification boundary. */
export interface ConversationRoutineProposalNotificationPort
{
	publish(command: ConversationRoutineProposalNotificationCommand): Promise<ConversationRoutineProposalNotificationOutcomes>;
}

/** Resolves the real current conversation participant for a checked requester Principal. */
export interface ConversationRoutineProposalRecipientReader
{
	readCurrent(command: ConversationRoutineProposalNotificationCommand): Promise<{ readonly participantId: string } | null>;
}

/** Dependencies of the built-in request_routine orchestration. */
export interface ConversationRequestRoutineDependencies
{
	readonly proposals: RequestRoutineProposalPort;
	readonly sources: ConversationRequestRoutineSourceResolver;
	readonly notifications: ConversationRoutineProposalNotificationPort;
}

/** Validated model suggestion together with the exact frozen source slot. */
export interface ConversationRequestRoutineProposal
{
	readonly source: RequestRoutineProposalSource;
	readonly suggestion: RequestRoutineSuggestion;
}
