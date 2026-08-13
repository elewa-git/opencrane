/** State of the caller's personal Agent in the conversation creation directory. */
export enum PersonalAgentDirectoryStatuses
{
	/** Exactly one active personal Agent matches the caller's approved persona. */
	Ready = "ready",
	/** No active personal Agent can currently start a conversation for this caller. */
	Unavailable = "unavailable",
	/** More than one active personal Agent matches, so the server refuses to choose one. */
	Ambiguous = "ambiguous",
}

/** An opaque active-member coordinate accepted by conversation creation. */
export interface ConversationParticipantDirectoryEntry
{
	/** Opaque membership reference; it never contains an OpenID Connect subject or email address. */
	readonly participantRef: string;
	/** Whether this entry represents the authenticated caller. */
	readonly isSelf: boolean;
}

/** Display-safe projection of the caller's sole active personal Agent. */
export interface ConversationPersonalAgentDirectoryEntry
{
	/** Opaque AgentService reference accepted only for this caller's Agent-session creation. */
	readonly personalAgentRef: string;
	/** User-facing Agent name stored on the active AgentService. */
	readonly displayName: string;
}

/** Self-scoped choices accepted by the conversation creation command. */
export interface ConversationCreationDirectory
{
	/** Active organisation members represented by opaque references. */
	readonly participants: readonly ConversationParticipantDirectoryEntry[];
	/** Explains whether an unambiguous personal Agent is available. */
	readonly personalAgentStatus: PersonalAgentDirectoryStatuses;
	/** The caller's personal Agent only when status is `ready`. */
	readonly personalAgent: ConversationPersonalAgentDirectoryEntry | null;
}
