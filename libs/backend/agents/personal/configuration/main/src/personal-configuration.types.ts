/** A durable request to change a personal agent only for a later immutable run snapshot. */
export interface ProposePersonalConfigurationChangeCommand
{
	/** Silo that owns every recorded source coordinate. */
	readonly siloId: string;
	/** User who initiated the change. */
	readonly userId: string;
	/** Personal persona profile whose active revision was observed. */
	readonly personaProfileId: string;
	/** Personal AgentService whose active revision was observed. */
	readonly agentServiceId: string;
	/** Conversation that supplied the request. */
	readonly sourceThreadId: string;
	/** Canonical run that recorded the request. */
	readonly sourceRunId: string;
	/** Optional message that caused the request. */
	readonly sourceMessageId: string | null;
	/** Opaque, validated request payload retained for future policy evaluation. */
	readonly requestedPatch: Readonly<Record<string, unknown>>;
	/** Canonical SHA-256 digest of the request payload. */
	readonly requestedPatchDigest: string;
	/** Active persona revision that must still be current before application. */
	readonly expectedPersonaRevisionId: string | null;
	/** Active agent revision that must still be current before application. */
	readonly expectedAgentRevisionId: string | null;
	/** Trusted proposal instant. */
	readonly proposedAt: string;
}

/** Atomic persistence result for one durable proposal. */
export type ProposePersonalConfigurationChangeResult =
	| { readonly outcome: "proposed"; readonly changeId: string }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "provenance_conflict" | "persistence_unavailable" };

/** Persistence boundary for append-only personal configuration proposals. */
export interface PersonalConfigurationChangeRepository
{
	/** Inserts one proposal only when every source coordinate is owned by the same user and silo. */
	proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: "proposed"; readonly changeId: string } | { readonly status: "provenance_conflict" } | { readonly status: "persistence_unavailable" }>;
}
