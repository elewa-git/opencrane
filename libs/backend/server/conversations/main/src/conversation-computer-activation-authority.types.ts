import type { ConversationComputerActivationCommand, ConversationComputerActivationOutcome } from "./conversation-computer-activation.types";

/** Resolves the release-admitted Agent Sandbox coordinates for one immutable computer profile. */
export interface ConversationComputerActivationProfileResolver
{
	/** Returns the fixed sandbox profile and warm pool for a current computer profile revision. */
	resolve(command: ConversationComputerActivationProfileCommand): Promise<ConversationComputerActivationProfile | null>;
}

/** Identifies the immutable profile that a loaded ConversationComputer requires. */
export interface ConversationComputerActivationProfileCommand
{
	/** Identifies the silo that owns the loaded ConversationComputer. */
	readonly siloId: string;
	/** Identifies the profile revision fixed in the computer's checked history. */
	readonly profileRevisionId: string;
}

/** Names the release-owned Agent Sandbox resources available to one profile revision. */
export interface ConversationComputerActivationProfile
{
	/** Names the namespace containing this release's Agent Sandbox claims and warm pools. */
	readonly namespace: string;
	/** Names the admission-policy-approved SandboxTemplate profile. */
	readonly sandboxProfile: string;
	/** Names the release-owned zero-replica warm pool for the sandbox profile. */
	readonly warmPoolName: string;
}

/** Provides the server time used to validate a computer lease before it reaches Kubernetes. */
export interface ConversationComputerActivationClock
{
	/** Returns the current server time. */
	now(): Date;
}

/** Decides one activation queue command from checked computer history and a fixed profile. */
export interface ConversationComputerActivationAuthorityDependencies
{
	/** Loads the current history snapshot without trusting profile or identity from the queue event. */
	readonly history: {
		/** Derives identity and profile from the computer's checked history. */
		loadForActivation(command: { readonly siloId: string; readonly computerId: string; readonly conversationId: string }): Promise<import("./conversation-computers").CurrentConversationComputer | null>;
	};
	/** Resolves one release-admitted sandbox profile from the history-bound profile revision. */
	readonly profiles: ConversationComputerActivationProfileResolver;
	/** Creates or proves the deterministic upstream Agent Sandbox claim. */
	readonly claims: import("@opencrane/backend/server/infra/agent-sandbox-claims").AgentSandboxClaimAuthority;
	/** Provides the server-owned instant used to reject an expired pending lease. */
	readonly clock: ConversationComputerActivationClock;
}

/** Checks the historical lease and emits the matching deterministic Agent Sandbox claim. */
export interface ConversationComputerActivationAuthorityPort
{
	/** Processes one durable activation event, returning a listener action without exposing Kubernetes state. */
	activate(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationOutcome>;
}
