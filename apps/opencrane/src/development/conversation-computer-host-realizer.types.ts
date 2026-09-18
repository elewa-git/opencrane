import type { Express } from "express";

import type { Logger } from "@opencrane/backend/observability";
import type { HostConversationComputerProcessOwnerOptions } from "@opencrane/backend/server/infra/conversation-computer-host";
import type { ConversationComputerProcessAuthenticator, ConversationComputerRealizer, ConversationComputerTurnAuthority } from "@opencrane/backend/server/conversations";

/** Supplies operating-system effects through the dedicated host-process infrastructure package. */
export type HostDevelopmentConversationComputerRealizerOptions = HostConversationComputerProcessOwnerOptions;

/** Supplies the private listener and process owner to the Tier 2 lifecycle. */
export interface HostDevelopmentConversationComputerSupervisorOptions
{
	/** Express app exposing the host process's bootstrap and model-step routes. */
	readonly app: Express;
	/** Loopback user port selected by the Tier 2 coordinator. */
	readonly port: number;
	/** Process owner closed beside the private listener. */
	readonly processes: { close(): Promise<void> };
}

/** Exposes one domain adapter through the two ports consumed by server composition. */
export interface HostDevelopmentConversationComputerRealizationOwner
{
	/** Authenticates private child bearers without reading caller-supplied lease coordinates. */
	readonly authenticator: ConversationComputerProcessAuthenticator;
	/** Maps process creation, lease fencing, renewal, and release to the conversations domain. */
	readonly realizer: ConversationComputerRealizer;
	/** Attempts to stop every child and remove every private bearer file, rejecting on cleanup failure. */
	stop(): Promise<void>;
}

/** Supplies authority and authentication without giving the local app another product owner. */
export interface HostDevelopmentConversationComputerPrivateAppOptions
{
	/** Authenticates one child bearer held by the workstation process owner. */
	readonly authenticator: ConversationComputerProcessAuthenticator;
	/** Owns bootstrap and model-step decisions. */
	readonly authority: ConversationComputerTurnAuthority;
	/** Records closed diagnostics without receiving request or bearer data. */
	readonly logger: Pick<Logger, "warn">;
}
