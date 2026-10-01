import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { WorkflowTaskRetryableError, WorkflowTaskRetryBackoffKinds, WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import type { IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

const _SDK = vi.hoisted(function _SdkHarness()
{
	return { handler: undefined as undefined | ((params: unknown, context: { taskID: string; task: { attempt: number } }) => Promise<unknown>) };
});

vi.mock("absurd-sdk", function _MockAbsurdSdk()
{
	class FailedTask extends Error {}
	class Absurd
	{
		registerTask(_options: unknown, handler: (params: unknown, context: { taskID: string; task: { attempt: number } }) => Promise<unknown>): void
		{
			_SDK.handler = handler;
		}
	}
	return { Absurd, FailedTask };
});

import { FailedTask } from "absurd-sdk";

import { AbsurdWorkflowEngine } from "../absurd-workflow-engine";

/** Create one adapter whose database writes can be asserted without a live engine. */
function _Harness(run: (context: IWorkflowTaskContext) => Promise<unknown>, checkpointOperationLeaseSeconds = 120)
{
	const query = vi.fn().mockResolvedValue({ rows: [] });
	const execution = new AbsurdWorkflowEngine({ checkpointOperationLeaseSeconds, databaseUrl: "postgresql://unused", databasePoolSize: 1, databasePool: { query } as unknown as Pool, queueAuthority: { queueForTask: function _Queue(): string { return "control-plane"; } } });
	execution.register({ taskName: "test.task", retryPolicy: { maximumAttempts: 5, backoff: { kind: WorkflowTaskRetryBackoffKinds.Exponential, initialDelaySeconds: 30 } }, run });
	return { query, handler: _SDK.handler as NonNullable<typeof _SDK.handler> };
}

describe("Absurd terminal task failures", function _TerminalTaskFailuresSuite()
{
	it("stores a terminal failure before stopping the SDK worker path", async function _StoresTerminalFailure()
	{
		const harness = _Harness(function _Run(): Promise<unknown> { throw new WorkflowTaskTerminalError("Input cannot become valid."); });

		await expect(harness.handler({ idempotencyKey: "stable-key", input: null, inputUndefined: false }, { taskID: "11111111-1111-4111-8111-111111111111", task: { attempt: 1 } })).rejects.toBeInstanceOf(FailedTask);

		expect(harness.query).toHaveBeenCalledWith('SELECT public."fail_absurd_task_terminal"($1, $2::uuid, $3::jsonb)', ["control-plane", "11111111-1111-4111-8111-111111111111", JSON.stringify({ name: "WorkflowTaskTerminalError", message: "Input cannot become valid." })]);
	});

	it("leaves retryable failures for Absurd to schedule", async function _LeavesRetryableFailure()
	{
		const failure = new WorkflowTaskRetryableError("Try later.");
		const harness = _Harness(function _Run(): Promise<unknown> { throw failure; });

		await expect(harness.handler({ idempotencyKey: "stable-key", input: null, inputUndefined: false }, { taskID: "22222222-2222-4222-8222-222222222222", task: { attempt: 1 } })).rejects.toBe(failure);
		expect(harness.query).not.toHaveBeenCalled();
	});

	it("passes the claimed Absurd attempt to the engine-neutral handler", async function _PassesClaimedAttempt()
	{
		const run = vi.fn().mockResolvedValue(null);
		const harness = _Harness(run);

		await harness.handler({ idempotencyKey: "stable-key", input: null, inputUndefined: false }, { taskID: "33333333-3333-4333-8333-333333333333", task: { attempt: 4 } });

		expect(run).toHaveBeenCalledWith(expect.objectContaining({ attempt: 4 }), null);
	});

	it("threads the configured checkpoint lease into the task context", async function _ThreadsCheckpointLease()
	{
		const heartbeat = vi.fn().mockResolvedValue(undefined);
		const step = vi.fn(async function _Step(_name: string, operation: () => Promise<string>): Promise<string> { return await operation(); });
		const run = async function _Run(context: IWorkflowTaskContext): Promise<string>
		{
			return await context.checkpoint({ stepName: "external-effect" }, async function _Effect(): Promise<string> { return "completed"; });
		};
		const harness = _Harness(run, 41);

		await harness.handler({ idempotencyKey: "stable-key", input: null, inputUndefined: false }, { taskID: "44444444-4444-4444-8444-444444444444", task: { attempt: 1 }, step, heartbeat } as never);

		expect(heartbeat).toHaveBeenCalledExactlyOnceWith(41);
	});
});
