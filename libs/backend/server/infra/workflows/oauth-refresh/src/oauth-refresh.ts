import { createHash } from "node:crypto";

import type { DurableExecution, DurableExecutionTransaction, DurableTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import { OAuthRefreshOutcomes, OAuthRefreshTaskNames, type OAuthRefreshConnectionPort, type OAuthRefreshResult, type OAuthRefreshTaskAdmission, type OAuthRefreshTaskInput, type OAuthRefreshWorkflow, type OAuthRefreshWorkflowOptions } from "./oauth-refresh.types";

/** Reject a blank identifier before it can merge work for different OAuth connections. */
function _RequireIdentifier(name: string, value: string): void
{
	if (value.trim().length === 0)
	{
		throw new Error(`${name} must be a non-empty string.`);
	}
}

/** Validate the identifiers and refresh cycle that are allowed to enter a saved OAuth refresh task. */
function _AssertTaskInput(input: OAuthRefreshTaskInput): void
{
	if (typeof input !== "object" || input === null || Array.isArray(input))
	{
		throw new Error("OAuth refresh task input must be an object.");
	}
	const names = Object.keys(input);
	if (names.length !== 4 || !names.every(function _AllowedName(name: string): boolean { return name === "siloId" || name === "subjectId" || name === "connectionId" || name === "refreshAt"; }))
	{
		throw new Error("OAuth refresh task input may contain only siloId, subjectId, connectionId, and refreshAt.");
	}
	_RequireIdentifier("siloId", input.siloId);
	_RequireIdentifier("subjectId", input.subjectId);
	_RequireIdentifier("connectionId", input.connectionId);
	const refreshAt = new Date(input.refreshAt);
	if (Number.isNaN(refreshAt.getTime()) || refreshAt.toISOString() !== input.refreshAt)
	{
		throw new Error("refreshAt must be a UTC ISO-8601 instant.");
	}
}

/** Reject a connection-port response that would save data beyond the three reviewed outcomes. */
function _AssertResult(result: OAuthRefreshResult): void
{
	if (typeof result !== "object" || result === null || Array.isArray(result))
	{
		throw new Error("OAuth refresh result must be an object.");
	}
	const names = Object.keys(result);
	if (names.length !== 1 || names[0] !== "outcome")
	{
		throw new Error("OAuth refresh result may contain only outcome.");
	}
	if (result.outcome !== OAuthRefreshOutcomes.Refreshed && result.outcome !== OAuthRefreshOutcomes.NeedsAuthorization && result.outcome !== OAuthRefreshOutcomes.Removed)
	{
		throw new Error("OAuth refresh result has an unsupported outcome.");
	}
}

/**
 * Build a stable key without writing a person or connection identifier into engine diagnostics.
 *
 * The refresh time distinguishes later cycles for one connection. Repeating the same four values
 * returns the same engine task, which prevents concurrent retries from doing the refresh twice.
 */
export function __OAuthRefreshTaskKey(input: OAuthRefreshTaskInput): string
{
	_AssertTaskInput(input);
	return `workflows:oauth-refresh:${createHash("sha256").update(JSON.stringify([input.siloId, input.subjectId, input.connectionId, input.refreshAt])).digest("hex")}`;
}

/** Run the connection-owned refresh through a replay-safe checkpoint. */
async function _RunRefresh(context: DurableTaskContext, connections: OAuthRefreshConnectionPort, input: OAuthRefreshTaskInput): Promise<OAuthRefreshResult>
{
	return await context.checkpoint({ stepName: "refresh-connection" }, async function _RefreshConnection(): Promise<OAuthRefreshResult>
	{
		const result = await connections.reconcile(input);
		_AssertResult(result);
		return result;
	});
}

/**
 * Register the OAuth refresh task and return its transaction-bound admission API.
 *
 * Application composition passes an execution port that already enforces its silo and queue policy.
 * The returned API then keeps a product write and the selected refresh task in the same database
 * transaction.
 */
export function __CreateOAuthRefreshWorkflow(options: OAuthRefreshWorkflowOptions): OAuthRefreshWorkflow
{
	const execution = options.execution;
	const connections = options.connections;
	execution.register({
		taskName: OAuthRefreshTaskNames.Reconcile,
		async run(context: DurableTaskContext, input: OAuthRefreshTaskInput): Promise<OAuthRefreshResult>
		{
			_AssertTaskInput(input);
			return await _RunRefresh(context, connections, input);
		},
	});

	return {
		async admit(transaction: DurableExecutionTransaction, input: OAuthRefreshTaskInput): Promise<OAuthRefreshTaskAdmission>
		{
			const taskKey = __OAuthRefreshTaskKey(input);
			const receipt = await execution.spawn(transaction, { taskName: OAuthRefreshTaskNames.Reconcile, idempotencyKey: taskKey, input });
			return { taskKey, receipt };
		},
	};
}
