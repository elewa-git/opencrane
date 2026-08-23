import type { DurableExecution, DurableExecutionTransaction, DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

/**
 * Stable task names that workflow composition may place on an approved queue.
 *
 * The queue policy must include {@link OAuthRefreshTaskNames.Reconcile} before this workflow is
 * registered. Keeping this name in one enum prevents an application and its worker from accepting
 * different strings for the same saved work.
 */
export enum OAuthRefreshTaskNames
{
	/** Rechecks one person's connection without persisting any OAuth credential. */
	Reconcile = "oauth-refresh.reconcile",
}

/**
 * Identifies one due refresh without carrying any OAuth credential.
 *
 * Product code creates this input after it decides a connection needs refreshing. The same
 * `refreshAt` value represents one refresh cycle, so a retry admits the existing task while a later
 * refresh cycle can create new work for the same subject and connection.
 */
export interface OAuthRefreshTaskInput
{
	/** Silo that owns the person and connection. */
	readonly siloId: string;
	/** Product-owned person or service identity that owns the connection. */
	readonly subjectId: string;
	/** Product-owned identifier for the OAuth connection to recheck. */
	readonly connectionId: string;
	/** UTC ISO-8601 time that identifies this connection's refresh cycle. */
	readonly refreshAt: string;
}

/** A saved OAuth refresh task together with its stable de-duplication key. */
export interface OAuthRefreshTaskAdmission
{
	/** Stable key for this silo, subject, and connection task. */
	readonly taskKey: string;
	/** Engine receipt for the admitted task. */
	readonly receipt: DurableTaskReceipt;
}

/**
 * The safe result of refreshing or checking one OAuth connection.
 *
 * The durable engine saves this result as the task output. Every member ends this refresh task; a
 * later `refreshAt` value is required to admit another task for the same connection.
 */
export enum OAuthRefreshOutcomes
{
	/** The remote service accepted the refresh, so this task ends with a usable connection. */
	Refreshed = "refreshed",
	/** The connection owner marks the connection as needing reconnection, then this task ends. */
	NeedsAuthorization = "needs-authorization",
	/** The connection no longer exists, so this task ends and no refresh is needed. */
	Removed = "removed",
}

/** The outcome the connection owner returns after it rechecks one connection. */
export interface OAuthRefreshResult
{
	/** Result that contains no credential material and is safe to save as task output. */
	readonly outcome: OAuthRefreshOutcomes;
}

/**
 * Owns connection lookup, OAuth refresh, and any product-state update.
 *
 * Called by: the registered refresh task. An implementation must read credentials from its own
 * custody boundary and return only {@link OAuthRefreshResult}; it must never return a token or a
 * remote response body because the workflow saves this result for replay.
 */
export interface OAuthRefreshConnectionPort
{
	/** Recheck one connection using its own credential custody boundary. */
	reconcile(input: OAuthRefreshTaskInput): Promise<OAuthRefreshResult>;
}

/** Dependencies used to register and admit the OAuth refresh task. */
export interface OAuthRefreshWorkflowOptions
{
	/** Durable execution that registers and saves the task. */
	readonly execution: DurableExecution;
	/** Product-owned port that refreshes the connection without exposing credentials. */
	readonly connections: OAuthRefreshConnectionPort;
}

/**
 * API that product composition uses to save one OAuth refresh task.
 *
 * Repeating an admission with the same input returns the original task. A later `refreshAt` value
 * creates a separate task for the next refresh cycle of the same connection.
 */
export interface OAuthRefreshWorkflow
{
	/** Save or return the task for one person and OAuth connection in this database transaction. */
	admit(transaction: DurableExecutionTransaction, input: OAuthRefreshTaskInput): Promise<OAuthRefreshTaskAdmission>;
}
