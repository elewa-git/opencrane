import type { HostConversationComputerProcessOwnerOptions } from "@opencrane/backend/server/infra/conversation-computer-host";
import type { ConversationComputerProcessAuthenticator, ConversationComputerProcessResolver, ConversationComputerRealizer } from "@opencrane/backend/server/conversations";

/** Supplies operating-system effects through the dedicated host-process infrastructure package. */
export type HostDevelopmentConversationComputerRealizerOptions = HostConversationComputerProcessOwnerOptions;

/** Exposes one domain adapter through the two ports consumed by server composition. */
export interface HostDevelopmentConversationComputerRealizationOwner
{
	/** Authenticates private child bearers without reading caller-supplied lease coordinates. */
	readonly authenticator: ConversationComputerProcessAuthenticator;
	/** Maps process creation, lease fencing, renewal, and release to the conversations domain. */
	readonly realizer: ConversationComputerRealizer & ConversationComputerProcessResolver;
	/** Attempts to stop every child and remove every private bearer file, rejecting on cleanup failure. */
	stop(): Promise<void>;
}
