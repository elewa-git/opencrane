import type { ConversationCaller } from "./types/conversation-caller.types";

/** Release-owned mapping from an agent workload label to one immutable computer profile. */
export interface AgentSessionReleaseProfile {
  /** Workload label stored on the active agent service. */
  readonly workloadProfile: string;
  /** Immutable profile revision admitted by this release. */
  readonly profileRevisionId: string;
}

/** Creates or rebuilds one deterministic personal agent-session projection. */
export interface InitialConversationComputerResolver {
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
