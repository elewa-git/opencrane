import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { z } from "zod";

/**
 * Stable task names that workflow composition may place on an approved queue.
 *
 * The queue policy must include {@link OAuthRefreshTaskNames.Reconcile} before this workflow is
 * registered. Keeping this name in one enum prevents an application and its worker from accepting
 * different strings for the same saved work.
 */
export enum OAuthRefreshTaskNames
{
	/** Rechecks one scoped connection without persisting any OAuth credential. */
	Reconcile = "oauth-refresh.reconcile",
}

/**
 * Names the product boundary that owns an OAuth connection.
 *
 * The task stores this value and includes it in its idempotency key, so a personal connection can
 * never merge with a connection shared by a group. This enum describes ownership only; it grants
 * no access to a credential.
 */
export enum OAuthRefreshScopeKinds
{
	/** One person's private connection. */
	Personal = "personal",
	/** A connection shared by one team. */
	Team = "team",
	/** A connection shared by one department. */
	Department = "department",
	/** A connection shared by one project. */
	Project = "project",
	/** A connection shared across the organisation. */
	Organization = "organization",
}

/**
 * Checks the small, credential-free input that may be stored and replayed by the workflow engine.
 *
 * Product code creates this input after it decides a connection needs refreshing. The same
 * `refreshAt` value represents one refresh cycle, so a retry admits the existing task while a later
 * refresh cycle can create new work for the same scoped connection. This schema rejects unknown
 * fields before task admission because engine storage must never receive OAuth credentials.
 */
export const OAuthRefreshTaskInputSchema = z.object({
	/** Stores the silo that owns the connection. */
	siloId: z.string().trim().min(1),
	/** Stores the product boundary that owns the connection. */
	scopeKind: z.nativeEnum(OAuthRefreshScopeKinds),
	/** Stores the product identity inside the connection's scope. */
	subjectId: z.string().trim().min(1),
	/** Stores the product identifier for the OAuth connection to recheck. */
	connectionId: z.string().trim().min(1),
	/** Stores the UTC ISO-8601 time that identifies this connection's refresh cycle. */
	refreshAt: z.string().refine(function _IsUtcInstant(value: string): boolean
	{
		const instant = new Date(value);
		return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
	}, "refreshAt must be a UTC ISO-8601 instant."),
}).strict();

/** Credential-free input stored by the workflow engine for one scoped OAuth refresh cycle. */
export type OAuthRefreshTaskInput = z.infer<typeof OAuthRefreshTaskInputSchema>;

/** A saved OAuth refresh task together with its stable de-duplication key. */
export interface OAuthRefreshTaskAdmission
{
	/** Stable key for this silo, scope, subject, and connection task. */
	readonly taskKey: string;
	/** Engine receipt for the admitted task. */
	readonly receipt: IWorkflowTaskReceipt;
}

/**
 * The safe result of refreshing or checking one OAuth connection.
 *
 * The workflow engine saves this result as the task output. Every member ends this refresh task; a
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
	/** Workflow engine that registers and saves the task. */
	readonly execution: IWorkflowEngine;
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
	/** Save or return the task for one scoped OAuth connection in this database transaction. */
	admit(transaction: IWorkflowTransaction, input: OAuthRefreshTaskInput): Promise<OAuthRefreshTaskAdmission>;
}
