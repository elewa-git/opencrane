import type { Logger } from "pino";

import type { ActiveConversationComputerExecution } from "./conversation-computers/conversation-computer-history.types";

/** The Kubernetes identity returned after the internal runtime route reviews a projected token. */
export interface ConversationComputerRuntimeIdentity
{
	/** Namespace Kubernetes read from the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** ServiceAccount name Kubernetes read from the reviewed subject. */
	readonly serviceAccountName: string;
	/** Pod UID Kubernetes bound into the reviewed projected token. */
	readonly podUid: string;
}

/** Narrow TokenReview port used by the ConversationComputer runtime bootstrap route. */
export interface ConversationComputerRuntimeIdentityReviewer
{
	/** Reviews one projected token and returns its workload identity, or null for every denial. */
	__Review(token: string): Promise<ConversationComputerRuntimeIdentity | null>;
}

/** Server-derived active execution reader used by the runtime bootstrap route. */
export interface ConversationComputerRuntimeBootstrapHistory
{
	/** Derives one active execution from a trusted silo, computer, and server clock. */
	loadActiveExecutionForBootstrap(command: { readonly siloId: string; readonly computerId: string; readonly nowEpochMilliseconds: number }): Promise<ActiveConversationComputerExecution>;
}

/** Trusted clock used to determine whether an active computer lease has expired. */
export interface ConversationComputerRuntimeBootstrapClock
{
	/** Returns the server time used for the history lease check. */
	now(): Date;
}

/** Dependencies that the OpenCrane process supplies to its internal runtime bootstrap route. */
export interface ConversationComputerRuntimeBootstrapRouterDependencies
{
	/** Reads the active computer execution from checked history. */
	readonly history: ConversationComputerRuntimeBootstrapHistory;
	/** Reviews the caller's projected ServiceAccount token. */
	readonly tokenReviewer: ConversationComputerRuntimeIdentityReviewer;
	/** Names the silo this process owns; a caller cannot select a different silo. */
	readonly siloId: string;
	/** Supplies the server clock for lease-expiry checks. */
	readonly clock: ConversationComputerRuntimeBootstrapClock;
	/** Records server-side failures without recording credentials or request bodies. */
	readonly logger: Logger;
}

/** Response issued to a Sandbox after its reviewed Pod identity matches its persisted lease. */
export interface ConversationComputerRuntimeBootstrapResponse
{
	/** Names the computer that owns this active execution. */
	readonly computerId: string;
	/** Names the conversation whose computer execution was admitted. */
	readonly conversationId: string;
	/** Names the server-created execution the Sandbox may bootstrap. */
	readonly executionId: string;
	/** Carries the generation that fences commands from an earlier Sandbox lease. */
	readonly leaseGeneration: number;
}
