import { describe, expect, it } from "vitest";

import { WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { __EnsureRespawnChainHead, __RespawnChainTaskKey, __SpawnRespawnChainSuccessor } from "../respawn-chain";
import type { RespawnChainTransaction } from "../respawn-chain.types";

interface SpawnCall
{
	readonly transaction: RespawnChainTransaction;
	readonly command: { readonly taskName: string; readonly idempotencyKey: string; readonly input: unknown };
}

/** Minimal workflow engine double that makes each scheduling admission observable. */
class WorkflowEngineDouble
{
	readonly calls: SpawnCall[] = [];

	async spawn(transaction: RespawnChainTransaction, command: SpawnCall["command"]): Promise<{ readonly taskId: string }>
	{
		this.calls.push({ transaction, command });
		return { taskId: `task-${this.calls.length}` };
	}
}

function _Transaction(): RespawnChainTransaction
{
	return { client: {} } as RespawnChainTransaction;
}

/** Narrows the test double to the one workflow engine operation this package may call. */
function _Execution(): IWorkflowEngine
{
	return new WorkflowEngineDouble() as unknown as IWorkflowEngine;
}

describe("respawn-chain task keys", function _TaskKeySuite()
{
	it("derives the same key for the same chain and slot", function _DerivesStableKey()
	{
		expect(__RespawnChainTaskKey("schedule-1", "2026-08-20T09:00:00.000Z")).toBe(__RespawnChainTaskKey("schedule-1", "2026-08-20T09:00:00.000Z"));
		expect(__RespawnChainTaskKey("schedule-1", "2026-08-20T09:00:00.000Z")).not.toBe(__RespawnChainTaskKey("schedule-1", "2026-08-20T10:00:00.000Z"));
	});

	it("rejects empty chain and slot identities", function _RejectsEmptyIdentity()
	{
		expect(function _EmptyChain() { __RespawnChainTaskKey("", "slot-1"); }).toThrow("chainKey");
		expect(function _EmptySlot() { __RespawnChainTaskKey("chain-1", " "); }).toThrow("slotKey");
	});
});

describe("respawn-chain task admission", function _AdmissionSuite()
{
	it("ensures a deterministic chain head through the transaction-bound workflow engine", async function _EnsuresHead()
	{
		const execution = _Execution();
		const observed = execution as unknown as WorkflowEngineDouble;
		const transaction = _Transaction();
		const first = await __EnsureRespawnChainHead(execution, { transaction, chainKey: "schedule-1", slotKey: "2026-08-20T09:00:00.000Z", taskName: "harvest", input: { source: "one" } });
		const repeated = await __EnsureRespawnChainHead(execution, { transaction, chainKey: "schedule-1", slotKey: "2026-08-20T09:00:00.000Z", taskName: "harvest", input: { source: "one" } });

		expect(first.taskKey).toBe(repeated.taskKey);
		expect(observed.calls).toHaveLength(2);
		expect(observed.calls[0]).toEqual({ transaction, command: { taskName: "harvest", idempotencyKey: first.taskKey, input: { source: "one" } } });
	});

	it("spawns a fresh deterministic successor only from a completed task", async function _SpawnsFreshSuccessor()
	{
		const execution = _Execution();
		const observed = execution as unknown as WorkflowEngineDouble;
		const transaction = _Transaction();
		const result = await __SpawnRespawnChainSuccessor(execution, { transaction, chainKey: "schedule-1", completed: { taskId: "task-1", slotKey: "2026-08-20T09:00:00.000Z", state: WorkflowTaskStates.Completed }, nextSlotKey: "2026-08-20T10:00:00.000Z", taskName: "harvest", input: { source: "one" } });

		expect(result.taskKey).toBe(__RespawnChainTaskKey("schedule-1", "2026-08-20T10:00:00.000Z"));
		expect(observed.calls[0]?.command.idempotencyKey).toBe(result.taskKey);
	});

	it("refuses to reuse the completed task slot", async function _RefusesReusedSlot()
	{
		const execution = _Execution();
		const observed = execution as unknown as WorkflowEngineDouble;
		await expect(__SpawnRespawnChainSuccessor(execution, { transaction: _Transaction(), chainKey: "schedule-1", completed: { taskId: "task-1", slotKey: "slot-1", state: WorkflowTaskStates.Completed }, nextSlotKey: "slot-1", taskName: "harvest", input: {} })).rejects.toThrow("fresh slot key");
		expect(observed.calls).toHaveLength(0);
	});

	it("refuses completion evidence without a stable predecessor slot", async function _RefusesMissingPredecessorSlot()
	{
		const execution = _Execution();
		const observed = execution as unknown as WorkflowEngineDouble;
		await expect(__SpawnRespawnChainSuccessor(execution, { transaction: _Transaction(), chainKey: "schedule-1", completed: { taskId: "task-1", slotKey: "", state: WorkflowTaskStates.Completed }, nextSlotKey: "slot-2", taskName: "harvest", input: {} })).rejects.toThrow("completed.slotKey");
		expect(observed.calls).toHaveLength(0);
	});

	it("refuses a terminal state that did not complete", async function _RefusesIncompleteTask()
	{
		const execution = _Execution();
		const observed = execution as unknown as WorkflowEngineDouble;
		const command = { transaction: _Transaction(), chainKey: "schedule-1", completed: { taskId: "task-1", slotKey: "slot-1", state: "cancelled" }, nextSlotKey: "slot-2", taskName: "harvest", input: {} } as unknown as Parameters<typeof __SpawnRespawnChainSuccessor>[1];

		await expect(__SpawnRespawnChainSuccessor(execution, command)).rejects.toThrow("Only a completed task");
		expect(observed.calls).toHaveLength(0);
	});
});
