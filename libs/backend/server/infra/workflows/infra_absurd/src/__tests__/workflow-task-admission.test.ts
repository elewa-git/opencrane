import { Prisma } from "@prisma/client";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { ___IsRolledBackConflict } from "@opencrane/backend/server/infra/prisma-unit-of-work";
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
		const admission = new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict);

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
		const admission = new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict);

		await expect(admission.admit(rootClient, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toThrow("caller-owned Prisma TransactionClient");
		expect(rootClient.$queryRaw).not.toHaveBeenCalled();
	});

	it("namespaces the stored key by task name when one queue owns multiple task definitions", async function _NamespacesTaskIdempotencyKeys()
	{
		const firstTransaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: true }]);
		const secondTransaction = _Transaction([{ task_id: "task-2", run_id: "run-2", attempt: 1, created: true }]);
		const admission = new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict);

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
		const admission = new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict);

		await admission.admit(firstTransaction, { taskName: "refresh-token", idempotencyKey: "request-42", input: {}, ..._RETRY });
		const repeated = await admission.admit(repeatedTransaction, { taskName: "refresh-token", idempotencyKey: "request-42", input: {}, ..._RETRY });

		expect(repeated).toEqual({ taskId: "task-1", runId: "run-1", attempt: 1, created: false });
	});

	it("rejects a malformed engine receipt instead of claiming task admission", async function _RejectsInvalidReceipt()
	{
		const transaction = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 0, created: true }]);

		await expect(new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict).admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toThrow("invalid task receipt");
	});

	it("normalises database failures without hiding the original cause", async function _NormalizesDatabaseFailure()
	{
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Prisma.TransactionClient;

		await expect(new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict).admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toBeInstanceOf(AbsurdWorkflowError);
	});

	it.each(["P2002", "P2034", "P2010"])("preserves the original proven rollback error %s", async function _preservesRollback(code)
	{
		const failure = new Prisma.PrismaClientKnownRequestError("rollback", { code, clientVersion: "test", meta: { code: "40001" } });
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(failure) } as unknown as Prisma.TransactionClient;
		await expect(new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict).admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toBe(failure);
	});

	it.each(["40P01", "23505", "08006", undefined])("keeps unrecognised raw-query failures wrapped: %s", async function _wrapsUnknown(sqlState)
	{
		const failure = new Prisma.PrismaClientKnownRequestError("40001 is not evidence in message text", { code: "P2010", clientVersion: "test", meta: { code: sqlState } });
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(failure) } as unknown as Prisma.TransactionClient;
		await expect(new WorkflowTaskAdmission("control-plane", ___IsRolledBackConflict).admit(transaction, { taskName: "refresh-token", idempotencyKey: "refresh:1", input: {}, ..._RETRY })).rejects.toMatchObject({ name: "AbsurdWorkflowError", cause: failure });
	});
});

describe("WorkflowTaskEventAdmission", function _WorkflowTaskEventAdmissionSuite()
{
	it("emits through the fixed parameterized Absurd procedure on the caller transaction", async function _CallsAbsurdEventProcedure()
	{
		const transaction = _Transaction([{ acknowledged: 1 }]);
		const admission = new WorkflowTaskEventAdmission("control-plane", ___IsRolledBackConflict);

		await admission.emit(transaction, "opencrane-task:task-1:event:completed:1", { preprocessJobId: "preprocess-1", deliveryCount: 1 });

		expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
		const [query, ...values] = vi.mocked(transaction.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
		expect(query.join(" ")).toContain("absurd.emit_event");
		expect(query.join(" ")).toContain("SELECT 1 AS acknowledged");
		expect(values).toEqual(["control-plane", "opencrane-task:task-1:event:completed:1", '{"preprocessJobId":"preprocess-1","deliveryCount":1}']);
	});

	it("rejects a root client and normalizes database failures", async function _RejectsInvalidPersistence()
	{
		const admission = new WorkflowTaskEventAdmission("control-plane", ___IsRolledBackConflict);
		const rootClient = { $queryRaw: vi.fn(), $transaction: vi.fn() };
		await expect(admission.emit(rootClient, "completed", {})).rejects.toThrow("caller-owned Prisma TransactionClient");
		expect(rootClient.$queryRaw).not.toHaveBeenCalled();

		const transaction = { $queryRaw: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Prisma.TransactionClient;
		await expect(admission.emit(transaction, "completed", {})).rejects.toBeInstanceOf(AbsurdWorkflowError);
	});

	it.each(["P2002", "P2034", "P2010"])("preserves the original event rollback error %s", async function _preservesEventRollback(code)
	{
		const failure = new Prisma.PrismaClientKnownRequestError("rollback", { code, clientVersion: "test", meta: { code: "40001" } });
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(failure) } as unknown as Prisma.TransactionClient;
		await expect(new WorkflowTaskEventAdmission("control-plane", ___IsRolledBackConflict).emit(transaction, "completed", {})).rejects.toBe(failure);
	});

	it.each(["40P01", "23505", "08006", undefined])("keeps unrecognised event failures wrapped: %s", async function _wrapsUnknownEvent(sqlState)
	{
		const failure = new Prisma.PrismaClientKnownRequestError("40001 is not evidence in message text", { code: "P2010", clientVersion: "test", meta: { code: sqlState } });
		const transaction = { $queryRaw: vi.fn().mockRejectedValue(failure) } as unknown as Prisma.TransactionClient;
		await expect(new WorkflowTaskEventAdmission("control-plane", ___IsRolledBackConflict).emit(transaction, "completed", {})).rejects.toMatchObject({ name: "AbsurdWorkflowError", cause: failure });
	});
});

describe("AbsurdWorkflowEngine queue authority", function _QueueAuthoritySuite()
{
	it("refuses both transactional paths before SQL when the worker has no rollback checker", async function _requiresRollbackChecker()
	{
		const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: {} as Pool, queueAuthority: { queueForTask(): string { return "control-plane"; } } });
		execution.declare({ taskName: "refresh-token" });
		const client = _Transaction([{ task_id: "task-1", run_id: "run-1", attempt: 1, created: true }]);
		const task = { taskId: "task-1", taskName: "refresh-token", idempotencyKey: "refresh:1" };
		await expect(execution.spawn({ client }, { taskName: task.taskName, idempotencyKey: task.idempotencyKey, input: {} })).rejects.toThrow("Transactional workflows require isRolledBackConflict");
		await expect(execution.emitEventInTransaction({ client }, task, { eventName: "completed", payload: {} })).rejects.toThrow("Transactional workflows require isRolledBackConflict");
		expect(client.$queryRaw).not.toHaveBeenCalled();
	});

	it("passes the unchanged database rollback through both engine transaction paths", async function _enginePreservesRollback()
	{
		const execution = new AbsurdWorkflowEngine({ isRolledBackConflict: ___IsRolledBackConflict, databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: {} as Pool, queueAuthority: { queueForTask(): string { return "control-plane"; } } });
		execution.declare({ taskName: "refresh-token" });
		const failure = new Prisma.PrismaClientKnownRequestError("rollback", { code: "P2010", clientVersion: "test", meta: { code: "40001" } });
		const client = { $queryRaw: vi.fn().mockRejectedValue(failure) };
		const task = { taskId: "task-1", taskName: "refresh-token", idempotencyKey: "refresh:1" };
		await expect(execution.spawn({ client }, { taskName: task.taskName, idempotencyKey: task.idempotencyKey, input: {} })).rejects.toBe(failure);
		await expect(execution.emitEventInTransaction({ client }, task, { eventName: "completed", payload: {} })).rejects.toBe(failure);
		expect(client.$queryRaw).toHaveBeenCalledTimes(2);
	});

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

	it("validates and normalizes the checkpoint operation lease", function _ValidatesCheckpointLease()
	{
		const queues = { queueForTask(): string { return "control-plane"; } };
		const databasePool = new Pool({ connectionString: "postgresql://example.invalid/opencrane", max: 1 });
		const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePool, databasePoolSize: 1, queueAuthority: queues, checkpointOperationLeaseSeconds: 37 });
		const options = (execution as unknown as { options: { checkpointOperationLeaseSeconds?: number } }).options;
		expect(options.checkpointOperationLeaseSeconds).toBe(37);

		const defaultExecution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePool, databasePoolSize: 1, queueAuthority: queues });
		const defaultOptions = (defaultExecution as unknown as { options: { checkpointOperationLeaseSeconds?: number } }).options;
		expect(defaultOptions.checkpointOperationLeaseSeconds).toBe(120);
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])
		{
			expect(function _InvalidCheckpointLease(): void { new AbsurdWorkflowEngine({ databaseUrl: "postgresql://example.invalid/opencrane", databasePool, databasePoolSize: 1, queueAuthority: queues, checkpointOperationLeaseSeconds: value }); }).toThrow("checkpointOperationLeaseSeconds must be a finite positive integer");
		}
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
