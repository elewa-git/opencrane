import type { IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { afterEach, describe, expect, it } from "vitest";

import type { IWorkflowHarness, IWorkflowHarnessFactory } from "./workflow-engine-contract.types";

/**
 * Runs the shared workflow-engine contract suite against a fresh test harness for each case.
 *
 * Called by: `fake-workflow-engine.test.ts`. Other engine adapter tests can call this helper
 * through the testing barrel, which checks behavior through the engine-neutral workflow contract.
 */
export function __TestWorkflowEngineContract(name: string, createHarness: IWorkflowHarnessFactory): void
{
	describe(name, function _Suite()
	{
		let harness: IWorkflowHarness | undefined;

		afterEach(async function _DisposeHarness()
		{
			await harness?.dispose?.();
			harness = undefined;
		});

		it("adopts a task with the caller-owned transaction and preserves its idempotency receipt", async function _AdmitTask()
		{
			harness = await createHarness();
			harness.execution.register(_Task("contract-admission", async function _RunTask()
			{
				return "admitted";
			}));

			const first = await harness.execution.spawn(harness.transaction, { taskName: "contract-admission", idempotencyKey: "admission-1", input: { request: "first" } });
			const repeated = await harness.execution.spawn(harness.transaction, { taskName: "contract-admission", idempotencyKey: "admission-1", input: { request: "repeated" } });

			expect(repeated).toEqual(first);
		});

		it("delivers events, checkpoints, child results, and a completed sleep through task context", async function _RunTaskContext()
		{
			harness = await createHarness();
			let result: string | undefined;
			harness.execution.register(_Task("contract-child", async function _RunChild(_context, input: { readonly value: string })
			{
				return input.value;
			}));
			harness.execution.register(_Task("contract-context", async function _RunContext(context)
			{
				const event = await context.waitForEvent<{ readonly value: string }>("approved");
				const child = await context.spawnChild({ taskName: "contract-child", idempotencyKey: "child-1", input: { value: event.payload.value } });
				const childResult = await context.awaitChild<string>(child);
				return context.checkpoint({ stepName: "persist-result" }, async function _SaveResult()
				{
					await context.sleepUntil(new Date(0));
					result = childResult;
					return childResult;
				});
			}));

			const task = await harness.execution.spawn(harness.transaction, { taskName: "contract-context", idempotencyKey: "context-1", input: undefined });
			await harness.execution.emitEvent(task, { eventName: "approved", payload: { value: "accepted" } });
			const worker = await harness.execution.startWorkers({ workerName: "contract-worker" });

			expect(worker.workerName).toBe("contract-worker");
			expect(result).toBe("accepted");
			await worker.drain();
			await worker.stop();
		});

		it("cancels a pending task before a worker can run its handler", async function _CancelTask()
		{
			harness = await createHarness();
			let ran = false;
			harness.execution.register(_Task("contract-cancel", async function _RunTask()
			{
				ran = true;
			}));

			const task = await harness.execution.spawn(harness.transaction, { taskName: "contract-cancel", idempotencyKey: "cancel-1", input: undefined });
			await harness.execution.cancel(task);
			await harness.execution.startWorkers({ workerName: "contract-worker" });

			expect(ran).toBe(false);
		});
	});
}

/** Build a typed task definition without adding a test helper to the production workflow contract. */
function _Task<TInput, TResult>(taskName: string, run: IWorkflowTaskDefinition<TInput, TResult>["run"]): IWorkflowTaskDefinition<TInput, TResult>
{
	return { taskName, run };
}
