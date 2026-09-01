import type { Logger } from "pino";

import type { ActiveConversationComputerExecution } from "./conversation-computers/conversation-computer-history.types";

/**
 * Identifies the Sandbox Pod authenticated by Kubernetes TokenReview.
 *
 * Bootstrap compares all three coordinates with `ComputerLease.runtimePod` before it releases an
 * execution. This identity therefore proves who made the request, but grants no execution by
 * itself.
 */
export interface ConversationComputerRuntimeIdentity
{
	/** Namespace Kubernetes read from the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** ServiceAccount name Kubernetes read from the reviewed subject. */
	readonly serviceAccountName: string;
	/** Pod UID Kubernetes bound into the reviewed projected token. */
	readonly podUid: string;
}

/**
 * Reviews the projected ServiceAccount token presented to the runtime bootstrap route.
 *
 * An implementation returns `null` for every denied token. The route must stop before it reads
 * computer history in that case, so an untrusted caller cannot use response differences to probe
 * computers.
 */
export interface ConversationComputerRuntimeIdentityReviewer
{
	/** Reviews one projected token and returns its workload identity, or null for every denial. */
	__Review(token: string): Promise<ConversationComputerRuntimeIdentity | null>;
}

/**
 * Reads an active execution from trusted history after the route supplies its fixed silo, one
 * computer identifier, and the server clock.
 *
 * The implementation derives the conversation and profile from the stored computer instead of
 * accepting them from the Sandbox. It throws for absent, foreign, inactive, or expired state; the
 * route reports those outcomes as a denial.
 */
export interface ConversationComputerRuntimeBootstrapHistory
{
	/** Derives one active execution from a trusted silo, computer, and server clock. */
	loadActiveExecutionForBootstrap(command: { readonly siloId: string; readonly computerId: string; readonly nowEpochMilliseconds: number }): Promise<ActiveConversationComputerExecution>;
}

/** Supplies the server time used to reject a lease that expired before bootstrap admission. */
export interface ConversationComputerRuntimeBootstrapClock
{
	/** Returns the server time used for the history lease check. */
	now(): Date;
}

/**
 * Binds the internal bootstrap route to server-owned history, identity review, and time.
 *
 * The route deliberately has no caller-supplied silo or execution dependencies. Those values are
 * what keep one authenticated Sandbox from selecting another computer's execution.
 */
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

/**
 * Returns the execution coordinates released to a Sandbox after its reviewed Pod identity matches
 * the active lease.
 *
 * The response contains server-derived identifiers and the lease generation that later commands
 * must fence against. It contains neither identity credentials nor a caller-selected execution.
 */
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
