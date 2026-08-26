import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowTaskNotRegisteredError, WorkflowTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

const _SDK = vi.hoisted(function _SdkHarness()
{
	return { spawn: vi.fn(), registerTask: vi.fn() };
});

vi.mock("absurd-sdk", function _MockAbsurdSdk()
{
	class FailedTask extends Error {}
	class Absurd
	{
		registerTask(...args: unknown[]): void
		{
			_SDK.registerTask(...args);
		}
		spawn(...args: unknown[]): Promise<{ taskID: string }>
		{
			return _SDK.spawn(...args) as Promise<{ taskID: string }>;
		}
	}
	return { Absurd, FailedTask };
});

import { AbsurdWorkflowEngine } from "../absurd-workflow-engine";
import { WorkflowTaskAdmission } from "../workflow-task-admission";

/** Build an adapter with one retrying task and no live database connection. */
function _Execution(): AbsurdWorkflowEngine
{
	const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: {} as Pool, queueAuthority: { queueForTask: function _Queue(): string { return "control-plane"; } } });
	execution.register({ taskName: "test.task", retryPolicy: { maximumAttempts: 5, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } }, run: async function _Run(): Promise<void> {} });
	return execution;
}

/** Build an engine that may admit a task whose controller registers the handler elsewhere. */
function _RemoteExecution(): AbsurdWorkflowEngine
{
	const execution = new AbsurdWorkflowEngine({ databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: {} as Pool, queueAuthority: { queueForTask: function _Queue(): string { return "control-plane"; } } });
	execution.declare({ taskName: "remote.task", retryPolicy: { maximumAttempts: 3, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 30 } } });
	return execution;
}

describe("Absurd task admission", function _TaskAdmissionSuite()
{
	beforeEach(function _Reset(): void
	{
		_SDK.spawn.mockReset();
		_SDK.registerTask.mockReset();
	});

	it("maps retry policy for a task spawned by another task", async function _MapsChildAdmission()
	{
		_SDK.spawn.mockResolvedValue({ taskID: "11111111-1111-4111-8111-111111111111" });
		const execution = _Execution();

		await execution.spawnFromTask({ taskName: "test.task", idempotencyKey: "child-key", input: { value: 1 } });

		expect(_SDK.spawn).toHaveBeenCalledWith("test.task", { idempotencyKey: "child-key", input: { value: 1 }, inputUndefined: false }, { queue: "control-plane", idempotencyKey: "[\"test.task\",\"child-key\"]", maxAttempts: 5, retryStrategy: { kind: "exponential", baseSeconds: 30, factor: 2, maxSeconds: 300 } });
	});

	it("maps the same retry policy into transaction-bound admission", async function _MapsTransactionAdmission()
	{
		const client = {};
		const transaction: IWorkflowTransaction = { client };
		const call = vi.spyOn(WorkflowTaskAdmission.prototype, "admit").mockResolvedValue({ taskId: "22222222-2222-4222-8222-222222222222", runId: "33333333-3333-4333-8333-333333333333", attempt: 1, created: true });
		const execution = _Execution();

		await execution.spawn(transaction, { taskName: "test.task", idempotencyKey: "root-key", input: { value: 2 } });

		expect(call).toHaveBeenCalledWith(client, { taskName: "test.task", idempotencyKey: "root-key", input: { idempotencyKey: "root-key", input: { value: 2 }, inputUndefined: false }, maximumAttempts: 5, retryStrategy: { kind: "exponential", baseSeconds: 30, factor: 2, maxSeconds: 300 } });
	});

	it("admits a declared remote task without registering a local handler", async function _AdmitsRemoteTask()
	{
		const client = {};
		const transaction: IWorkflowTransaction = { client };
		const call = vi.spyOn(WorkflowTaskAdmission.prototype, "admit").mockResolvedValue({ taskId: "44444444-4444-4444-8444-444444444444", runId: "55555555-5555-4555-8555-555555555555", attempt: 1, created: true });
		const execution = _RemoteExecution();

		await expect(execution.spawn(transaction, { taskName: "remote.task", idempotencyKey: "remote-key", input: { validationId: "validation-1" } })).resolves.toEqual({ taskId: "44444444-4444-4444-8444-444444444444", taskName: "remote.task", idempotencyKey: "remote-key" });

		expect(_SDK.registerTask).not.toHaveBeenCalled();
		expect(call).toHaveBeenCalledWith(client, { taskName: "remote.task", idempotencyKey: "remote-key", input: { idempotencyKey: "remote-key", input: { validationId: "validation-1" }, inputUndefined: false }, maximumAttempts: 3, retryStrategy: { kind: "fixed", baseSeconds: 30, factor: undefined, maxSeconds: undefined } });
	});

	it("rejects a conflicting retry policy for an existing declaration", function _RejectsDeclarationConflict()
	{
		const execution = _RemoteExecution();

		expect(function _Redeclare(): void
		{
			execution.declare({ taskName: "remote.task", retryPolicy: { maximumAttempts: 4, backoff: { kind: WorkflowTaskRetryBackoffKinds.Fixed, initialDelaySeconds: 30 } } });
		}).toThrow("Workflow task remote.task has a different declaration.");
	});

	it("requires a local handler when a running task starts child work", async function _RejectsRemoteChildTask()
	{
		const execution = _RemoteExecution();

		await expect(execution.spawnFromTask({ taskName: "remote.task", idempotencyKey: "child-key", input: { value: 1 } })).rejects.toBeInstanceOf(WorkflowTaskNotRegisteredError);
		expect(_SDK.spawn).not.toHaveBeenCalled();
	});
});
