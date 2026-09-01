import type { Prisma } from "@prisma/client";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { WorkflowError } from "@opencrane/backend/server/infra/workflows/contract";

import { AbsurdWorkflowEngine } from "../absurd-workflow-engine";
import { AbsurdWorkflowError } from "../absurd-workflow-error";
import { WorkflowTaskAdmission } from "../workflow-task-admission";
import { WorkflowTaskEventAdmission } from "../workflow-task-event-admission";

const _RETRY = { maximumAttempts: 5, retryStrategy: { kind: "exponential", baseSeconds: 30, factor: 2, maxSeconds: 300 } } as const;

/** Builds the one caller-owned transaction shape the gateway is permitted to use. */
function _Transaction(rows: unknown): Prisma.TransactionClient
{
	return { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as Prisma.TransactionClient;
}

describe("WorkflowTaskAdmission", function _WorkflowTaskAdmissionSuite()
{
	it("admits through the fixed parameterized Absurd procedure on the caller transaction", async function _CallsAbsurdAdmissionProcedure()
	{
		const transaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: true }]);
		const admission = new WorkflowTaskAdmission("control-plane");

		const receipt = await admission.admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: { connectionId: "connection-1" }, ..._RETRY });

		expect(receipt).toEqual({ taskId: "task-1", runId: "run-1", attempt: 1, created: true });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		const [query, ...values] = vi.mocked(transaction.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
		expect(query.join(" ")).toContain("absurd.spawn_task");
		expect(values).toEqual(["control-plane", "refresh-token", '{"connectionId":"connection-1"}', '{"idempotency_key":"[\\"refresh-token\\",\\"refresh:1\\"]","max_attempts":5,"retry_strategy":{"kind":"exponential","base_seconds":30,"factor":2,"max_seconds":300}}']);
	});

	it("rejects a root Prisma client so admission cannot outlive the product transaction", async function _RejectsRootClient()
	{
		const rootClient = { $queryRaw: vi.fn(), $transaction: vi.fn() };
		const admission = new WorkflowTaskAdmission("control-plane");

		await expect(admission.admit(rootClient, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toThrow("caller-owned Prisma TransactionClient");
		expect(rootClient.$queryRaw).not.toHaveBeenCalled();
	});

	it("namespaces the stored key by task name when one queue owns multiple task definitions", async function _NamespacesTaskIdempotencyKeys()
	{
		const firstTransaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: true }]);
		const secondTransaction = _Transaction([{ task_id: "task-2", run_id: "run-2", attempt: 1, created: true }]);
		const admission = new WorkflowTaskAdmission("control-plane");

		await admission.admit(firstTransaction, { taskName: "refresh-token", idempotencyKey: "request-42", input: {}, ..._RETRY });
		await admission.admit(secondTransaction, { taskName: "rotate-key", idempotencyKey: "request-42", input: {}, ..._RETRY });

		const [, ...firstValues] = vi.mocked(firstTransaction.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
		const [, ...secondValues] = vi.mocked(secondTransaction.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
		expect(firstValues.at(-1)).not.toBe(secondValues.at(-1));
	});

	it("returns the existing task receipt when the same task repeats its idempotency key", async function _RepeatedTaskAdmission()
	{
		const firstTransaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: true }]);
		const repeatedTransaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: false }]);
		const admission = new WorkflowTaskAdmission("control-plane");

		await admission.admit(firstTransaction, { taskName: "refresh-token", idempotencyKey: "request-42", input: {}, ..._RETRY });
		const repeated = await admission.admit(repeatedTransaction, { taskName: "refresh-token", idempotencyKey: "request-42", input: {}, ..._RETRY });

		expect(repeated).toEqual({ taskId: "task-1", runId: "run-1", attempt: 1, created: false });
	});

	it("rejects a malformed engine receipt instead of claiming task admission", async function _RejectsInvalidReceipt()
	{
		const transaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 0, created: true }]);

		await expect(new WorkflowTaskAdmission("control-plane").admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toThrow("invalid task receipt");
	});

	it("normalises database failures without hiding the original cause", async function _NormalizesDatabaseFailure()
	{
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Prisma.TransactionClient;

		await expect(new WorkflowTaskAdmission("control-plane").admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toBeInstanceOf(AbsurdWorkflowError);
	});
});

describe("WorkflowTaskEventAdmission", function _WorkflowTaskEventAdmissionSuite()
{
	it("emits through the fixed parameterized Absurd procedure on the caller transaction", async function _CallsAbsurdEventProcedure()
	{
		const transaction = _Transaction([{ emit_event: null }]);
		const admission = new WorkflowTaskEventAdmission("control-plane");

		await admission.emit(transaction, "opencrane-task:task-1:event:completed:1", { preprocessJobId: "preprocess-1", deliveryCount: 1 });

		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		const [query, ...values] = vi.mocked(transaction.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
		expect(query.join(" ")).toContain("absurd.emit_event");
		expect(values).toEqual(["control-plane", "opencrane-task:task-1:event:completed:1", '{"preprocessJobId":"preprocess-1","deliveryCount":1}']);
	});

	it("rejects a root client and normalizes database failures", async function _RejectsInvalidPersistence()
	{
		const admission = new WorkflowTaskEventAdmission("control-plane");
		const rootClient = { $queryRaw: vi.fn(), $transaction: vi.fn() };
		await expect(admission.emit(rootClient, "completed", {})).rejects.toThrow("caller-owned Prisma TransactionClient");
		expect(rootClient.$queryRaw).not.toHaveBeenCalled();

		const transaction = { $queryRaw: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Prisma.TransactionClient;
		await expect(admission.emit(transaction, "completed", {})).rejects.toBeInstanceOf(AbsurdWorkflowError);
	});
});

describe("AbsurdWorkflowEngine queue authority", function _QueueAuthoritySuite()
{
	it("rejects an unreviewed task instead of falling back to an adapter queue", function _RejectsQueueFallback()
	{
		const queues = Object.freeze({
			queueForTask(taskName: string): string
			{
				if (taskName !== "refresh-token")
				{
					throw new WorkflowError("Task has no reviewed queue.");
				}
				return "control-plane";
			},
		});
		const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePoolSize: 2, queueAuthority: queues });

		expect(execution.queueForTask("refresh-token")).toBe("control-plane");
		expect(function _UnreviewedTask(): void { execution.queueForTask("unreviewed"); }).toThrow("Task has no reviewed queue.");
	});

	it("requires one explicit shared database pool ceiling", function _RequiresPoolCeiling()
	{
		const queues = { queueForTask(): string { return "control-plane"; } };
		expect(function _MissingCeiling(): void { new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePoolSize: 0, queueAuthority: queues }); }).toThrow("databasePoolSize must be a positive integer");
	});

	it("drains workers before ending its owned shared pool", async function _ClosesOwnedPool()
	{
		const order: string[] = [];
		const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePoolSize: 2, queueAuthority: { queueForTask(): string { return "control-plane"; } } });
		const internals = execution as unknown as { databasePool: Pool; workerGroups: Map<string, readonly { close(): Promise<void> }[]> };
		internals.workerGroups.set("server", [{ async close(): Promise<void> { order.push("worker"); } }]);
		vi.spyOn(internals.databasePool, "end").mockImplementation(async function _End(): Promise<void> { order.push("pool"); });

		await execution.close();

		expect(order).toEqual(["worker", "pool"]);
	});

	it("does not end a caller-owned shared pool", async function _PreservesExternalPool()
	{
		const databasePool = new Pool({ connectionString: "postgresql://example.invalid/opencrane", max: 2 });
		const end = vi.spyOn(databasePool, "end");
		const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePool, databasePoolSize: 2, queueAuthority: { queueForTask(): string { return "control-plane"; } } });

		await execution.close();

		expect(end).not.toHaveBeenCalled();
		await databasePool.end();
	});
});
