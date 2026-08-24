import { describe, expect, it, vi } from "vitest";

import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";
import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority, WorkflowPayloadValidationError, WorkflowTaskPolicyError } from "../index";

/** Task input accepted by this test workflow. */
interface TestTaskInput
{
	/** Silo whose data the test task is allowed to process. */
	readonly siloId: string;
	/** Plain task input that cannot carry credentials. */
	readonly requestId: string;
}

/** Returns a transaction-shaped value for the engine-free workflow test double. */
function _Transaction(): IWorkflowTransaction
{
	return { client: {} };
}

/** Create a silo-bound guard with one reviewed queue. */
function _Guard(execution: __FakeWorkflowEngine)
{
	return __CreateWorkflowGuard({ execution, siloId: "silo-a", queueAuthority: __CreateWorkflowTaskQueueAuthority([{ taskName: "archive", queue: "maintenance" }]) });
}

/** Register a checkpointed task whose result makes a successful dispatch observable. */
function _RegisterArchiveTask(guard: ReturnType<typeof _Guard>): void
{
	guard.register({
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

describe("workflow guard policy", function _PolicySuite()
{
	it("admits and runs a task only when its input belongs to the configured silo", async function _RunsSiloTask()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);
		_RegisterArchiveTask(guard);
		const receipt = await guard.spawn(_Transaction(), _Task({ siloId: "silo-a", requestId: "request-1" }));
		await execution.startWorkers({ workerName: "workflow-test" });

		expect(execution.taskSnapshot(receipt).result).toBe("request-1");
	});

	it("rejects an input from another silo before the engine can persist it", async function _RejectsOtherSilo()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);
		_RegisterArchiveTask(guard);

		await expect(guard.spawn(_Transaction(), _Task({ siloId: "silo-b", requestId: "request-1" }))).rejects.toBeInstanceOf(WorkflowTaskPolicyError);
	});

	it("rejects credential-shaped fields anywhere in a task payload", async function _RejectsCredentials()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);
		_RegisterArchiveTask(guard);
		const task = { taskName: "archive", idempotencyKey: "archive:request-1", input: { siloId: "silo-a", requestId: "request-1", nested: { accessToken: "must-not-persist" } } };

		await expect(guard.spawn(_Transaction(), task)).rejects.toBeInstanceOf(WorkflowPayloadValidationError);
	});

	it("rejects non-object input before a registered task handler receives it", async function _RejectsMalformedInput()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);
		_RegisterArchiveTask(guard);

		await expect(guard.spawn(_Transaction(), { taskName: "archive", idempotencyKey: "task-1", input: "not-an-object" })).rejects.toBeInstanceOf(WorkflowPayloadValidationError);
	});

	it("rejects a silo identifier with surrounding whitespace instead of changing saved input", async function _RejectsNonCanonicalSiloId()
	{
		const execution = new __FakeWorkflowEngine();
		const spawn = vi.spyOn(execution, "spawn");
		const guard = _Guard(execution);
		_RegisterArchiveTask(guard);

		await expect(guard.spawn(_Transaction(), _Task({ siloId: " silo-a ", requestId: "request-1" }))).rejects.toBeInstanceOf(WorkflowPayloadValidationError);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("rejects a task name that is absent from the reviewed queue policy", async function _RejectsUnknownTask()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);

		await expect(guard.spawn(_Transaction(), { taskName: "unreviewed", idempotencyKey: "task-1", input: { siloId: "silo-a" } })).rejects.toBeInstanceOf(WorkflowTaskPolicyError);
	});

	it("normalizes checkpoint failures before the engine stores an error projection", async function _NormalizesStepFailure()
	{
		const execution = new __FakeWorkflowEngine();
		const guard = _Guard(execution);
		guard.register({
			taskName: "archive",
			async run(context): Promise<void>
			{
				await context.checkpoint({ stepName: "persist" }, async function _Persist(): Promise<void> { throw new Error("credential value must not leak"); });
			},
		});
		const receipt = await guard.spawn(_Transaction(), _Task({ siloId: "silo-a", requestId: "request-1" }));
		await execution.startWorkers({ workerName: "workflow-test" });
		const error = execution.taskSnapshot(receipt).error as Error;

		expect(error.message).toBe("Workflow checkpoint failed.");
		expect(error.message).not.toContain("credential value");
	});
});

describe("workflow guard helpers", function _HelperSuite()
{
	it("builds one frozen authority and rejects duplicate or unknown task policies", function _RejectsInvalidQueueAuthorityPolicy()
	{
		const queues = __CreateWorkflowTaskQueueAuthority([{ taskName: "archive", queue: "maintenance" }]);

		expect(queues.queueForTask("archive")).toBe("maintenance");
		expect(Object.isFrozen(queues)).toBe(true);
		expect(function _DuplicatePolicy(): void { __CreateWorkflowTaskQueueAuthority([{ taskName: "archive", queue: "maintenance" }, { taskName: "archive", queue: "maintenance" }]); }).toThrow(WorkflowTaskPolicyError);
		expect(function _UnknownTask(): void { queues.queueForTask("unreviewed"); }).toThrow(WorkflowTaskPolicyError);
	});
});
