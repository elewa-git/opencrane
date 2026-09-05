import type { ConversationCaller } from "./types/conversation-caller.types";

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

/** Creates or rebuilds one deterministic personal agent-session projection. */
export interface InitialConversationComputerResolver
{
  /** Returns the deterministic conversation id after Kurrent and projection authority agree. */
  resolve(
    caller: ConversationCaller,
    personalAgentRef: string,
  ): Promise<string | null>;
  /** Establishes immutable history for a direct or group conversation before projection writes. */
  createOrdinaryGenesis(
    caller: ConversationCaller,
    conversationId: string,
    mode: "direct" | "group",
  ): Promise<void>;
}
