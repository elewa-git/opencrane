/**
 * Lists the AgentService kinds that the release profile-selection policy may map to a computer profile.
 *
 * The command carries a previously resolved service kind so the release map, rather than a caller,
 * chooses the profile.
 */
export const ConversationComputerAgentServiceKinds = {
	/** Selects the profile for a platform-managed AgentService. */
	Managed: "managed",
	/** Selects the profile for a participant-owned personal AgentService. */
	Personal: "personal",
} as const;

/**
 * Names the trusted AgentService kind supplied to the release profile selector.
 *
 * The selector returns no profile when this kind is not configured for the local silo, so the
 * implementation never substitutes a default profile.
 */
export type ConversationComputerAgentServiceKind = typeof ConversationComputerAgentServiceKinds[keyof typeof ConversationComputerAgentServiceKinds];

/**
 * Carries the trusted coordinates used to select a release-owned computer profile.
 *
 * Callers supply both values after they have resolved the AgentService. Keeping them in the command
 * prevents the selector from accepting a Sandbox profile directly.
 */
export interface ConversationComputerProfileSelectionCommand
{
	/** Identifies the silo where the selected profile may be realized. */
	readonly siloId: string;
	/** Identifies the already-resolved service kind; browser input cannot choose this value. */
	readonly agentServiceKind: ConversationComputerAgentServiceKind;
}

/**
 * Selects the immutable computer profile revision admitted by this release for a trusted service kind.
 *
 * A `null` result means that the local release does not admit a profile for the silo or service kind;
 * callers receive no substituted default profile.
 * `_CreateConversationComputerAgentServiceProfileSelector` composes the production implementation.
 */
export interface ConversationComputerProfileSelector
{
	/** Returns the selected revision, or `null` when the release does not admit this command. */
	select(command: ConversationComputerProfileSelectionCommand): Promise<{ readonly profileRevisionId: string } | null>;
}
