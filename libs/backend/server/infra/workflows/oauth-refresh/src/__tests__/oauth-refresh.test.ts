import { describe, expect, it, vi } from "vitest";

import { __FakeDurableExecution } from "@opencrane/backend/server/infra/workflows/testing";
import type { DurableExecutionTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateOAuthRefreshWorkflow, __OAuthRefreshTaskKey, OAuthRefreshOutcomes, OAuthRefreshScopeKinds, OAuthRefreshTaskNames } from "../index";
import type { OAuthRefreshConnectionPort, OAuthRefreshTaskInput } from "../index";

/** Return a transaction-shaped object for an engine-free workflow test. */
function _Transaction(): DurableExecutionTransaction
{
	return { client: {} };
}

/** Return a credential-free task input owned by one scope, subject, connection, and refresh cycle. */
function _Input(refreshAt: string = "2026-08-23T12:00:00.000Z"): OAuthRefreshTaskInput
{
	return { siloId: "silo-a", scopeKind: OAuthRefreshScopeKinds.Personal, subjectId: "principal-a", connectionId: "connection-a", refreshAt };
}

/** Start the deterministic fake workers after one OAuth task has been admitted. */
async function _Drain(execution: __FakeDurableExecution): Promise<void>
{
	await execution.startWorkers({ workerName: "oauth-refresh-test" });
}

describe("OAuth refresh workflow", function _OAuthRefreshWorkflowSuite()
{
	it("de-duplicates one refresh cycle, then admits the next cycle for the same connection", async function _RefreshesConnection()
	{
		const execution = new __FakeDurableExecution();
		const reconcile = vi.fn().mockResolvedValue({ outcome: OAuthRefreshOutcomes.Refreshed });
		const workflow = __CreateOAuthRefreshWorkflow({ execution, connections: { reconcile } });
		const first = await workflow.admit(_Transaction(), _Input());
		const repeated = await workflow.admit(_Transaction(), _Input());

		expect(first.taskKey).toBe(repeated.taskKey);
		expect(first.receipt).toBe(repeated.receipt);
		expect(first.receipt.taskName).toBe(OAuthRefreshTaskNames.Reconcile);
		await _Drain(execution);
		expect(reconcile).toHaveBeenCalledWith(_Input());
		expect(execution.taskSnapshot(first.receipt).result).toEqual({ outcome: OAuthRefreshOutcomes.Refreshed });

		const next = await workflow.admit(_Transaction(), _Input("2026-08-23T13:00:00.000Z"));
		expect(next.receipt).not.toBe(first.receipt);
		await _Drain(execution);
		expect(reconcile).toHaveBeenCalledTimes(2);
	});

	it("keeps scope, subject, and connection identifiers out of the engine task key", function _HidesIdentifiers()
	{
		const key = __OAuthRefreshTaskKey(_Input());

		expect(key).not.toContain("principal-a");
		expect(key).not.toContain("connection-a");
		expect(key).toMatch(/^workflows:oauth-refresh:[a-f0-9]{64}$/u);
	});

	it("keeps independently scoped connections in separate tasks", function _SeparatesScopes()
	{
		expect(__OAuthRefreshTaskKey(_Input())).not.toBe(__OAuthRefreshTaskKey({ ..._Input(), scopeKind: OAuthRefreshScopeKinds.Team }));
	});

	it("rejects a blank task identity before a task can be admitted", async function _RejectsBlankIdentity()
	{
		const execution = new __FakeDurableExecution();
		const connections: OAuthRefreshConnectionPort = { reconcile: vi.fn().mockResolvedValue({ outcome: OAuthRefreshOutcomes.Removed }) };
		const workflow = __CreateOAuthRefreshWorkflow({ execution, connections });

		await expect(workflow.admit(_Transaction(), { ..._Input(), connectionId: " " })).rejects.toThrow("connectionId");
		await expect(workflow.admit(_Transaction(), { ..._Input(), refreshAt: "tomorrow" })).rejects.toThrow("refreshAt");
		await expect(workflow.admit(_Transaction(), { ..._Input(), scopeKind: "unknown" } as unknown as OAuthRefreshTaskInput)).rejects.toThrow("scopeKind");
	});

	it("refuses input or output fields that could save a credential", async function _RejectsCredentialFields()
	{
		const execution = new __FakeDurableExecution();
		const workflow = __CreateOAuthRefreshWorkflow({ execution, connections: { reconcile: vi.fn().mockResolvedValue({ outcome: OAuthRefreshOutcomes.Refreshed, refreshToken: "must-not-save" }) } });

		await expect(workflow.admit(_Transaction(), { ..._Input(), accessToken: "must-not-save" } as unknown as OAuthRefreshTaskInput)).rejects.toThrow("may contain only");
		const admitted = await workflow.admit(_Transaction(), _Input());
		await _Drain(execution);
		const error = execution.taskSnapshot(admitted.receipt).error;
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("may contain only outcome");
	});
});
