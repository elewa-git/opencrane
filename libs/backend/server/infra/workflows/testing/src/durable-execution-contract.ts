import type { DurableTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { afterEach, describe, expect, it } from "vitest";

import type { DurableExecutionContractHarness, DurableExecutionContractHarnessFactory } from "./durable-execution-contract.types";

/** Add engine-neutral durable execution assertions to an adapter's Vitest suite. */
export function _DescribeDurableExecutionContract(name: string, createHarness: DurableExecutionContractHarnessFactory): void
{
	describe(name, function _suite()
	{
		let harness: DurableExecutionContractHarness | undefined;

		afterEach(async function _disposeHarness()
		{
			await harness?.dispose?.();
			harness = undefined;
		});

		it("adopts a task with the caller-owned transaction and preserves its idempotency receipt", async function _admitTask()
		{
			harness = await createHarness();
			harness.execution.register(_Task("contract-admission", async function _runTask()
			{
				return "admitted";
			}));

			const first = await harness.execution.spawn(harness.transaction, { taskName: "contract-admission", idempotencyKey: "admission-1", input: { request: "first" } });
			const repeated = await harness.execution.spawn(harness.transaction, { taskName: "contract-admission", idempotencyKey: "admission-1", input: { request: "repeated" } });

			expect(repeated).toEqual(first);
		});

		it("delivers events, checkpoints, child results, and a completed sleep through task context", async function _runTaskContext()
		{
			harness = await createHarness();
			let result: string | undefined;
			harness.execution.register(_Task("contract-child", async function _runChild(_context, input: { readonly value: string })
			{
				return input.value;
			}));
			harness.execution.register(_Task("contract-context", async function _runContext(context)
			{
				const event = await context.waitForEvent<{ readonly value: string }>("approved");
				const child = await context.spawnChild({ taskName: "contract-child", idempotencyKey: "child-1", input: { value: event.payload.value } });
				const childResult = await context.awaitChild<string>(child);
				return context.checkpoint({ stepName: "persist-result" }, async function _saveResult()
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

		it("cancels a pending task before a worker can run its handler", async function _cancelTask()
		{
			harness = await createHarness();
			let ran = false;
			harness.execution.register(_Task("contract-cancel", async function _runTask()
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

/** Create a typed definition without exposing a test helper as part of the production contract. */
function _Task<TInput, TResult>(taskName: string, run: DurableTaskDefinition<TInput, TResult>["run"]): DurableTaskDefinition<TInput, TResult>
{
	return { taskName, run };
}
