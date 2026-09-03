import type { ConversationComputerHistory } from "./conversation-computers";

/**
 * Resolves the release-admitted Agent Sandbox coordinates for one immutable computer profile.
 *
 * The activation authority asks this port after history has fixed `profileRevisionId`; an
 * implementation must not infer a profile from queue input. Returning `null` tells the authority to
 * park the delivery before it writes `ClaimDispatched`, while a result may be used for that exact
 * history-bound revision.
 *
 * Called by: `ConversationComputerActivationClaimAuthority`.
 */
export interface ConversationComputerActivationProfileResolver
{
	/**
	 * Resolves fixed Sandbox coordinates for a history-bound revision.
	 *
	 * @param command - Supplies the silo and profile revision read from checked computer history.
	 * @returns Approved claim coordinates, or null when the current release does not admit them.
	 */
	resolve(command: ConversationComputerActivationProfileCommand): Promise<ConversationComputerActivationProfile | null>;
}

/**
 * Identifies the immutable profile that a loaded ConversationComputer requires.
 *
 * The activation event does not carry either value as authority. History supplies both values before
 * the resolver selects a release-owned Sandbox profile.
 */
export interface ConversationComputerActivationProfileCommand
{
	/** Identifies the silo that owns the loaded ConversationComputer. */
	readonly siloId: string;
	/** Identifies the profile revision fixed in the computer's checked history. */
	readonly profileRevisionId: string;
}

/**
 * Names the release-owned Agent Sandbox resources available to one profile revision.
 *
 * These coordinates tell the claim adapter where and how to request isolated compute. They do not
 * authorize conversation work; the computer lease and later command authorities retain that role.
 */
export interface ConversationComputerActivationProfile
{
	/** Names the namespace containing this release's Agent Sandbox claims and warm pools. */
	readonly namespace: string;
	/** Names the ServiceAccount fixed by this profile's immutable SandboxTemplate. */
	readonly serviceAccountName: string;
	/** Names the admission-policy-approved SandboxTemplate profile. */
	readonly sandboxProfile: string;
	/** Names the release-owned zero-replica warm pool for the sandbox profile. */
	readonly warmPoolName: string;
	/** Carries the release selectors that the claim controller must stamp onto the resulting Pod. */
	readonly podLabels: import("@opencrane/backend/server/infra/agent-sandbox-claims").AgentSandboxClaimPodLabels;
}

/**
 * Provides the server time used to validate a computer lease before it reaches Kubernetes.
 *
 * The queue delivery cannot supply this time, because it could otherwise make an expired claimed
 * lease appear current when the activation authority records or retries its dispatch.
 */
export interface ConversationComputerActivationClock
{
	/** Returns the current server time. */
	now(): Date;
}

/**
 * Supplies the checked dependencies for deciding one activation queue command.
 *
 * History owns lifecycle state, the resolver admits release-owned coordinates, and the claim port
 * realizes a deterministic Kubernetes request. Keeping those roles separate prevents a queue
 * delivery from selecting either a profile or a second computer lease.
 */
export interface ConversationComputerActivationAuthorityDependencies
{
	/** Loads the current history snapshot without trusting profile or identity from the queue event. */
	readonly history: Pick<ConversationComputerHistory, "append" | "loadForActivation">;
	/** Resolves one release-admitted sandbox profile from the history-bound profile revision. */
	readonly profiles: ConversationComputerActivationProfileResolver;
	/** Creates or proves the deterministic upstream Agent Sandbox claim. */
	readonly claims: import("@opencrane/backend/server/infra/agent-sandbox-claims").AgentSandboxClaimAuthority;
	/** Provides the server-owned instant used to reject an expired pending lease. */
	readonly clock: ConversationComputerActivationClock;
}
