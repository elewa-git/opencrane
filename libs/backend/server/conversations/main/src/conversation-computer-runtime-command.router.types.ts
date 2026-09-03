import type { ConversationComputerRuntimeCommandEnvelope, ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import type { Logger } from "pino";

import type { ActiveConversationComputerExecution } from "./conversation-computers/conversation-computer-history.types";
import type { ConversationComputerRuntimeCommandPollCommand } from "./conversation-computers/conversation-computer-runtime-command-authority.types";
import type { ConversationComputerRuntimeIdentityReviewer } from "./conversation-computer-runtime-bootstrap.router.types";

/** Loads the execution derived from one Sandbox-selected computer before command dispatch. */
export interface ConversationComputerRuntimeCommandHistory
{
	/** Derives the only active execution a reviewed Sandbox Pod may access. */
	loadActiveExecutionForBootstrap(command: { readonly siloId: string; readonly computerId: string; readonly nowEpochMilliseconds: number }): Promise<ActiveConversationComputerExecution>;
}

/** Selects and completes durable commands after the router has authenticated the Sandbox Pod. */
export interface ConversationComputerRuntimeCommandAuthorityPort
{
	/** Selects the oldest command still awaiting a terminal report. */
	poll(command: ConversationComputerRuntimeCommandPollCommand): Promise<{ readonly command: ConversationComputerRuntimeCommandEnvelope | null }>;
	/** Records one terminal report only when it matches the current head command. */
	complete(command: ConversationComputerRuntimeCommandPollCommand & { readonly report: ConversationComputerRuntimeTerminalReport }): Promise<void>;
}

/** Supplies the server time used when lease-fencing a runtime command request. */
export interface ConversationComputerRuntimeCommandRouterClock
{
	/** Returns the instant used to reject an expired active lease. */
	now(): Date;
}

/** Binds the internal runtime command route to identity, history, and durable command authority. */
export interface ConversationComputerRuntimeCommandRouterDependencies
{
	/** Reviews the Sandbox projected token before history reads. */
	readonly tokenReviewer: ConversationComputerRuntimeIdentityReviewer;
	/** Derives the active execution from the selected computer. */
	readonly history: ConversationComputerRuntimeCommandHistory;
	/** Selects and completes the execution-fenced command queue. */
	readonly authority: ConversationComputerRuntimeCommandAuthorityPort;
	/** Names the silo fixed by server composition. */
	readonly siloId: string;
	/** Supplies the server clock used for active-lease checks. */
	readonly clock: ConversationComputerRuntimeCommandRouterClock;
	/** Records bounded operational failures without logging credentials or request bodies. */
	readonly logger: Logger;
}
