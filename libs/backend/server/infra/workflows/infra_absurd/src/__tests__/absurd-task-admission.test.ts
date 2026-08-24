import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DurableTaskRetryBackoffKinds } from "@opencrane/backend/server/infra/workflows/contract";
import type { DurableExecutionTransaction } from "@opencrane/backend/server/infra/workflows/contract";

const _SDK = vi.hoisted(function _SdkHarness()
{
	return { spawn: vi.fn() };
});

vi.mock("absurd-sdk", function _MockAbsurdSdk()
{
	class FailedTask extends Error {}
	class Absurd
	{
		registerTask(): void {}
		spawn(...args: unknown[]): Promise<{ taskID: string }>
		{
			return _SDK.spawn(...args) as Promise<{ taskID: string }>;
		}
	}
	return { Absurd, FailedTask };
});

import { AbsurdDurableExecution } from "../absurd-durable-execution";
import { PrismaDbProcedureGateway } from "../prisma-db-procedure-gateway";

/** Build an adapter with one retrying task and no live database connection. */
function _Execution(): AbsurdDurableExecution
{
	const execution = new AbsurdDurableExecution({ databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: {} as Pool, queueAuthority: { queueForTask: function _Queue(): string { return "control-plane"; } } });
	execution.register({ taskName: "test.task", retryPolicy: { maximumAttempts: 5, backoff: { kind: DurableTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30, multiplier: 2, maximumDelaySeconds: 300 } }, run: async function _Run(): Promise<void> {} });
	return execution;
}

describe("Absurd task admission", function _TaskAdmissionSuite()
{
	beforeEach(function _Reset(): void
	{
		_SDK.spawn.mockReset();
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
		const transaction: DurableExecutionTransaction = { client };
		const call = vi.spyOn(PrismaDbProcedureGateway.prototype, "___DbProcedureCall").mockResolvedValue({ taskId: "22222222-2222-4222-8222-222222222222", runId: "33333333-3333-4333-8333-333333333333", attempt: 1, created: true });
		const execution = _Execution();

		await execution.spawn(transaction, { taskName: "test.task", idempotencyKey: "root-key", input: { value: 2 } });

		expect(call).toHaveBeenCalledWith(client, { taskName: "test.task", idempotencyKey: "root-key", input: { idempotencyKey: "root-key", input: { value: 2 }, inputUndefined: false }, maximumAttempts: 5, retryStrategy: { kind: "exponential", baseSeconds: 30, factor: 2, maxSeconds: 300 } });
	});
});
