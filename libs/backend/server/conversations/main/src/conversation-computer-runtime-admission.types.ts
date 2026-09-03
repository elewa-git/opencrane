import type { Logger } from "pino";

import type { ActiveConversationComputerExecution } from "./conversation-computers/conversation-computer-history.types";

/**
 * Identifies the Sandbox Pod authenticated by Kubernetes TokenReview.
 *
 * Admission compares every coordinate with `ComputerLease.runtimePod` before releasing an
 * execution. The identity therefore proves which Pod made a request; it does not grant an
 * execution by itself.
 */
export interface ConversationComputerRuntimeIdentity
{
	/** Names the Kubernetes namespace read from the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** Names the ServiceAccount Kubernetes read from the reviewed subject. */
	readonly serviceAccountName: string;
	/** Names the Pod UID Kubernetes bound into the reviewed projected token. */
	readonly podUid: string;
}

/**
 * Reviews a projected ServiceAccount token before a route reads caller-selected computer history.
 *
 * A denied review returns `null`, and the route must stop there so an untrusted caller cannot use
 * response differences to probe computers.
 */
export interface ConversationComputerRuntimeIdentityReviewer
{
	/** Returns the workload identity, or null for each token that does not meet the route policy. */
	__Review(token: string): Promise<ConversationComputerRuntimeIdentity | null>;
}

/**
 * Loads an active execution after a Sandbox route has accepted one computer identifier.
 *
 * The implementation derives the conversation and profile from the stored computer instead of
 * accepting them from the Sandbox. It throws for absent, foreign, inactive, or expired state;
 * admission reports those outcomes as a denial.
 */
export interface ConversationComputerRuntimeAdmissionHistory
{
	/** Derives the one active execution a reviewed Sandbox Pod may access. */
	loadActiveExecutionForBootstrap(command: { readonly siloId: string; readonly computerId: string; readonly nowEpochMilliseconds: number }): Promise<ActiveConversationComputerExecution>;
}

/** Supplies the server clock that every Sandbox admission route uses to reject expired leases. */
export interface ConversationComputerRuntimeAdmissionClock
{
	/** Returns the instant used to reject expired leases. */
	now(): Date;
}

/**
 * Binds shared Sandbox admission to the reviewer, history, and fixed deployment silo.
 *
 * The routes expose no caller-supplied silo or execution dependencies. Keeping those coordinates
 * server-owned prevents an authenticated Sandbox from selecting another computer's execution.
 */
export interface ConversationComputerRuntimeAdmissionDependencies
{
	/** Reviews the caller's projected ServiceAccount token before history reads. */
	readonly tokenReviewer: ConversationComputerRuntimeIdentityReviewer;
	/** Derives the active execution from the selected computer. */
	readonly history: ConversationComputerRuntimeAdmissionHistory;
	/** Names the deployment silo that the caller cannot select. */
	readonly siloId: string;
	/** Supplies the server time used for lease expiry checks. */
	readonly clock: ConversationComputerRuntimeAdmissionClock;
	/** Records bounded failures without retaining tokens or request bodies. */
	readonly logger: Logger;
}

/**
 * Returns the reviewed caller and matching active execution for an admitted Sandbox request.
 *
 * Routes derive their conversation, profile, execution, and lease values from `active`; callers
 * must not recreate those coordinates from request content.
 */
export interface AdmittedConversationComputerRuntime
{
	/** Identifies the reviewed Pod bound to the active lease. */
	readonly identity: ConversationComputerRuntimeIdentity;
	/** Carries the server-derived conversation, execution, profile, and lease coordinates. */
	readonly active: ActiveConversationComputerExecution;
}
