/** Lists the durable AgentService kinds a ConversationComputer profile-selection policy recognizes. */
export const ConversationComputerAgentServiceKinds = {
	Managed: "managed",
	Personal: "personal",
} as const;

/** Names one AgentService kind whose computer profile must be selected by the release. */
export type ConversationComputerAgentServiceKind = typeof ConversationComputerAgentServiceKinds[keyof typeof ConversationComputerAgentServiceKinds];

/** Carries the trusted coordinates for one release-owned computer profile selection. */
export interface ConversationComputerProfileSelectionCommand
{
	/** Identifies the silo where the selected profile may be realized. */
	readonly siloId: string;
	/** Identifies the already-resolved service kind; browser input cannot choose this value. */
	readonly agentServiceKind: ConversationComputerAgentServiceKind;
}

/** Returns the immutable computer profile revision selected by release policy, or no profile. */
export interface ConversationComputerProfileSelector
{
	select(command: ConversationComputerProfileSelectionCommand): Promise<{ readonly profileRevisionId: string } | null>;
}
