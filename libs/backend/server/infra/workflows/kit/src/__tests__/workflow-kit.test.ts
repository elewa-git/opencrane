import { describe, expect, it } from "vitest";

import { __FakeDurableExecution } from "@opencrane/backend/server/infra/workflows/testing";
import type { DurableExecutionTransaction, DurableTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateWorkflowKit, __CreateWorkflowTaskQueueAuthority, __WorkflowTaskKeyDigest, __WorkflowTaskQueueMap, WorkflowPayloadFirewallError, WorkflowTaskPolicyError } from "../index";

/** Task input accepted by this test workflow. */
interface TestTaskInput
{
	/** Silo whose data the test task is allowed to process. */
	readonly siloId: string;
	/** Plain durable input that cannot carry credentials. */
	readonly requestId: string;
}

/** Return a transaction-shaped value for the engine-free durable execution test double. */
function _Transaction(): DurableExecutionTransaction
{
	return { client: {} };
}

/** Create a silo-bound kit with one reviewed queue. */
function _Kit(execution: __FakeDurableExecution)
{
	return __CreateWorkflowKit({ execution, siloId: "silo-a", queueAuthority: __CreateWorkflowTaskQueueAuthority([{ taskName: "archive", queue: "maintenance" }]) });
}

/** Register a checkpointed task whose result makes a successful dispatch observable. */
function _RegisterArchiveTask(kit: ReturnType<typeof _Kit>): void
{
	kit.register({
		taskName: "archive",
		async run(context, input: TestTaskInput): Promise<string>
		{
			return await context.checkpoint({ stepName: "persist" }, async function _Persist(): Promise<string> { return input.requestId; });
		},
	});
}

/** Return a task command that belongs to the configured test silo. */
function _Task(input: TestTaskInput): { readonly taskName: string; readonly idempotencyKey: string; readonly input: TestTaskInput }
{
	return { taskName: "archive", idempotencyKey: "archive:request-1", input };
}

describe("workflow kit policy", function _PolicySuite()
{
	it("admits and runs a task only when its input belongs to the configured silo", async function _RunsSiloTask()
	{
		const execution = new __FakeDurableExecution();
		const kit = _Kit(execution);
		_RegisterArchiveTask(kit);
		const receipt = await kit.spawn(_Transaction(), _Task({ siloId: "silo-a", requestId: "request-1" }));
		await execution.startWorkers({ workerName: "workflow-test" });

		expect(execution.taskSnapshot(receipt).result).toBe("request-1");
	});

	it("rejects an input from another silo before the engine can persist it", async function _RejectsOtherSilo()
	{
		const execution = new __FakeDurableExecution();
		const kit = _Kit(execution);
		_RegisterArchiveTask(kit);

		await expect(kit.spawn(_Transaction(), _Task({ siloId: "silo-b", requestId: "request-1" }))).rejects.toBeInstanceOf(WorkflowTaskPolicyError);
	});

	it("rejects credential-shaped fields anywhere in a task payload", async function _RejectsCredentials()
	{
		const execution = new __FakeDurableExecution();
		const kit = _Kit(execution);
		_RegisterArchiveTask(kit);
		const task = { taskName: "archive", idempotencyKey: "archive:request-1", input: { siloId: "silo-a", requestId: "request-1", nested: { accessToken: "must-not-persist" } } };

		await expect(kit.spawn(_Transaction(), task)).rejects.toBeInstanceOf(WorkflowPayloadFirewallError);
	});

	it("rejects a task name that is absent from the reviewed queue policy", async function _RejectsUnknownTask()
	{
		const execution = new __FakeDurableExecution();
		const kit = _Kit(execution);

		await expect(kit.spawn(_Transaction(), { taskName: "unreviewed", idempotencyKey: "task-1", input: { siloId: "silo-a" } })).rejects.toBeInstanceOf(WorkflowTaskPolicyError);
	});

	it("normalizes checkpoint failures before the engine stores an error projection", async function _NormalizesStepFailure()
	{
		const execution = new __FakeDurableExecution();
		const kit = _Kit(execution);
		kit.register({
			taskName: "archive",
			async run(context): Promise<void>
			{
				await context.checkpoint({ stepName: "persist" }, async function _Persist(): Promise<void> { throw new Error("credential value must not leak"); });
			},
		});
		const receipt = await kit.spawn(_Transaction(), _Task({ siloId: "silo-a", requestId: "request-1" }));
		await execution.startWorkers({ workerName: "workflow-test" });
		const error = execution.taskSnapshot(receipt).error as Error;

		expect(error.message).toBe("Workflow checkpoint failed.");
		expect(error.message).not.toContain("credential value");
	});
});

describe("workflow kit helpers", function _HelperSuite()
{
	it("returns one frozen queue map and rejects duplicate policy entries", function _BuildsQueueMap()
	{
		const queues = __WorkflowTaskQueueMap([{ taskName: "archive", queue: "maintenance" }]);

		expect(queues).toEqual({ archive: "maintenance" });
		expect(Object.isFrozen(queues)).toBe(true);
		expect(function _DuplicatePolicy(): void { __WorkflowTaskQueueMap([{ taskName: "archive", queue: "maintenance" }, { taskName: "archive", queue: "maintenance" }]); }).toThrow(WorkflowTaskPolicyError);
	});

	it("rejects an unreviewed task through the shared queue authority", function _RejectsUnknownQueueAuthorityTask()
	{
		const queues = __CreateWorkflowTaskQueueAuthority([{ taskName: "archive", queue: "maintenance" }]);

		expect(queues.queueForTask("archive")).toBe("maintenance");
		expect(function _UnknownTask(): void { queues.queueForTask("unreviewed"); }).toThrow(WorkflowTaskPolicyError);
	});

	it("hashes task keys before callers place them in diagnostics", function _DigestsTaskKey()
	{
		expect(__WorkflowTaskKeyDigest("archive:request-1")).not.toContain("archive:request-1");
		expect(__WorkflowTaskKeyDigest("archive:request-1")).toHaveLength(64);
	});

});
