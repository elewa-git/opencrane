import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Release-owned mapping from an agent workload label to one immutable computer profile. */
export interface AgentSessionReleaseProfile
{
  /** Workload label stored on the active agent service. */
  readonly workloadProfile: string;
  /** Immutable profile revision admitted by this release. */
  readonly profileRevisionId: string;
}

/** Relational facts frozen between precheck and Kurrent creation. */
export interface AgentSessionCandidate
{
	/** Identifies the active personal service. */
	readonly agentServiceId: string;
	/** Supplies the participant-facing identity name. */
	readonly agentName: string;
	/** Carries the mapped immutable computer profile revision. */
	readonly profileRevisionId: string;
	/** Preserves the service label that selected the release profile. */
	readonly workloadProfile: string;
}

/** Deterministic coordinates shared by history and projection owners. */
export interface AgentSessionCoordinates
{
	/** Identifies the Kurrent-owned conversation. */
	readonly conversationId: string;
	/** Identifies the caller-bound proxied identity. */
	readonly agentIdentityId: string;
	/** Identifies the DNS-safe logical computer. */
	readonly computerId: string;
}

/** Creates or recovers a personal session for a caller-scoped creation command. */
export interface InitialConversationComputerResolver
{
  /** Returns the same conversation for retries of a UUID, including after its computer has run. */
  resolve(
    caller: ConversationCaller,
    personalAgentRef: string,
    idempotencyKey: string,
  ): Promise<string | null>;
  /** Establishes immutable history for a direct or group conversation before projection writes. */
  createOrdinaryGenesis(
    caller: ConversationCaller,
    conversationId: string,
    mode: "direct" | "group",
  ): Promise<void>;
}
