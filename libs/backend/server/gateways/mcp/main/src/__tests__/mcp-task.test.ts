import { describe, expect, it, vi } from "vitest";

import type { IWorkflowEngine, IWorkflowTaskContext, IWorkflowTaskDefinition, IWorkflowTaskEventReceipt, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { __CreateMcpTaskWorkflow } from "../mcp-tasks/mcp-task";
import { getMcpTask, submitMcpTask, submitMcpTaskInput } from "../mcp-tasks/mcp-task-submission";
import { McpTaskInputSubmissionOutcomes, McpTaskStates, McpTaskTaskNames } from "../mcp-tasks/mcp-task.types";
import type { McpTaskRecord, McpTaskWorkflowInput } from "../mcp-tasks/mcp-task.types";

/** Build one saved product task with optional workflow and input-response facts. */
function _Task(overrides: Partial<McpTaskRecord> = {}): McpTaskRecord
{
	return {
		id: "mcp-task-1",
		siloId: "silo-1",
		principalId: "principal-1",
		callDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		toolName: "collect-details",
		state: McpTaskStates.Working,
		inputRequest: { requestId: "details", message: "What details should this task use?" },
		inputResponse: null,
		result: null,
		failureCode: null,
		workflowTask: { taskId: "absurd-task-1", taskName: McpTaskTaskNames.Call, idempotencyKey: "workflows:mcp-task:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
		...overrides,
	};
}

/** Build a unit of work whose task repository is the supplied focused test double. */
function _UnitOfWork(mcpTasks: Record<string, unknown>): McpOperatorUnitOfWork
{
	const transaction = { mcpTasks, workflowTransaction: { client: {} } } as unknown as McpOperatorTransaction;
	return {
		async execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result>
		{
			return await operation(transaction);
		},
	};
}

describe("MCP task lifecycle", function _DescribeMcpTaskLifecycle()
{
	it("saves a task and binds its Absurd admission in one product transaction", async function _ItSavesTaskAndAdmission()
	{
		const task = _Task({ workflowTask: null });
		const createOrFind = vi.fn().mockResolvedValue({ created: true, task });
		const ensureWorkflow = vi.fn().mockResolvedValue(_Task());
		const unitOfWork = _UnitOfWork({ createOrFind, ensureWorkflow });
		const admit = vi.fn().mockResolvedValue({ receipt: _Task().workflowTask, taskKey: _Task().workflowTask!.idempotencyKey });
		const workflow = { admit, deliverInput: vi.fn() };

		const saved = await submitMcpTask(unitOfWork, workflow, { siloId: "silo-1", principalId: "principal-1" }, { idempotencyKey: "call-1", toolName: "collect-details", arguments: { source: "client" }, inputRequest: { requestId: "details", message: "What details should this task use?" } });

		expect(saved).toMatchObject({ id: "mcp-task-1", workflowTask: { taskId: "absurd-task-1" } });
		expect(admit).toHaveBeenCalledWith(expect.objectContaining({ client: {} }), expect.objectContaining({ siloId: "silo-1", mcpTaskId: "mcp-task-1" }));
		expect(ensureWorkflow).toHaveBeenCalledWith("silo-1", "mcp-task-1", expect.objectContaining({ taskId: "absurd-task-1", taskName: McpTaskTaskNames.Call }));
	});

	it("uses the same call digest when JSON object keys arrive in a different order", async function _ItCanonicalizesCallArguments()
	{
		const createOrFind = vi.fn().mockResolvedValue({ created: true, task: _Task({ workflowTask: null }) });
		const unitOfWork = _UnitOfWork({ createOrFind, ensureWorkflow: vi.fn().mockResolvedValue(_Task()) });
		const workflow = { admit: vi.fn().mockResolvedValue({ receipt: _Task().workflowTask, taskKey: _Task().workflowTask!.idempotencyKey }), deliverInput: vi.fn() };

		await submitMcpTask(unitOfWork, workflow, { siloId: "silo-1", principalId: "principal-1" }, { idempotencyKey: "call-1", toolName: "collect-details", arguments: { first: "one", second: "two" }, inputRequest: { requestId: "details", message: "What details should this task use?" } });
		await submitMcpTask(unitOfWork, workflow, { siloId: "silo-1", principalId: "principal-1" }, { idempotencyKey: "call-1", toolName: "collect-details", arguments: { second: "two", first: "one" }, inputRequest: { requestId: "details", message: "What details should this task use?" } });

		expect(createOrFind.mock.calls[0]![0].callDigest).toBe(createOrFind.mock.calls[1]![0].callDigest);
	});

	it("keeps a task private to its authenticated principal", async function _ItKeepsTaskPrivate()
	{
		const find = vi.fn().mockResolvedValue(null);
		const task = await getMcpTask(_UnitOfWork({ find }), { siloId: "silo-1", principalId: "principal-2" }, "mcp-task-1");

		expect(task).toBeNull();
		expect(find).toHaveBeenCalledWith("silo-1", "principal-2", "mcp-task-1");
	});

	it("persists a matching client answer before it delivers the task event", async function _ItDeliversMatchingInput()
	{
		const task = _Task({ state: McpTaskStates.InputRequired });
		const find = vi.fn().mockResolvedValue(task);
		const recordInput = vi.fn().mockResolvedValue(task);
		const deliverInput = vi.fn().mockResolvedValue(undefined);
		const workflow = { admit: vi.fn(), deliverInput };

		const result = await submitMcpTaskInput(_UnitOfWork({ find, recordInput }), workflow, { siloId: "silo-1", principalId: "principal-1" }, "mcp-task-1", { requestId: "details", value: "The saved answer" });

		expect(result).toEqual({ outcome: McpTaskInputSubmissionOutcomes.Accepted, task });
		expect(deliverInput).toHaveBeenCalledWith(task.workflowTask, expect.objectContaining({ callDigest: task.callDigest }), { requestId: "details", value: "The saved answer" });
	});

	it("refuses an answer for a different saved request without sending an event", async function _ItRefusesConflictingInput()
	{
		const find = vi.fn().mockResolvedValue(_Task({ state: McpTaskStates.InputRequired }));
		const deliverInput = vi.fn();
		const workflow = { admit: vi.fn(), deliverInput };

		const result = await submitMcpTaskInput(_UnitOfWork({ find, recordInput: vi.fn() }), workflow, { siloId: "silo-1", principalId: "principal-1" }, "mcp-task-1", { requestId: "another-request", value: "Unexpected" });

		expect(result).toEqual({ outcome: McpTaskInputSubmissionOutcomes.Conflict });
		expect(deliverInput).not.toHaveBeenCalled();
	});

	it("waits for saved input and records its final bounded result", async function _ItWaitsForInput()
	{
		let definition: IWorkflowTaskDefinition<McpTaskWorkflowInput, string> | null = null;
		const receipt: IWorkflowTaskReceipt = _Task().workflowTask!;
		const engine = {
			register(candidate: unknown): void { definition = candidate as IWorkflowTaskDefinition<McpTaskWorkflowInput, string>; },
			async spawn(): Promise<IWorkflowTaskReceipt> { return receipt; },
			async emitEvent(): Promise<IWorkflowTaskEventReceipt> { return { task: receipt, eventName: "event" }; },
			async cancel(): Promise<IWorkflowTaskReceipt> { return receipt; },
		} as unknown as IWorkflowEngine;
		const initial = _Task();
		const waiting = _Task({ state: McpTaskStates.InputRequired });
		const completed = _Task({ state: McpTaskStates.Completed, inputResponse: { requestId: "details", value: "Saved answer" }, result: "Saved answer" });
		const load = vi.fn().mockResolvedValue(initial);
		const recordInputRequired = vi.fn().mockResolvedValue(waiting);
		const recordCompleted = vi.fn().mockResolvedValue(completed);
		const workflow = __CreateMcpTaskWorkflow({ execution: engine, unitOfWork: _UnitOfWork({ load, recordInputRequired, recordCompleted }) });
		const input: McpTaskWorkflowInput = { siloId: "silo-1", mcpTaskId: "mcp-task-1", callDigest: initial.callDigest };

		const context = {
			task: receipt,
			attempt: 1,
			async checkpoint(_step: unknown, operation: () => Promise<unknown>): Promise<unknown> { return await operation(); },
			async waitForEvent(): Promise<unknown> { return { eventName: "input", payload: { requestId: "details", value: "Saved answer" } }; },
			async spawnChild(): Promise<IWorkflowTaskReceipt> { return receipt; },
			async awaitChild(): Promise<unknown> { return ""; },
			async sleepUntil(): Promise<void> {},
		} as unknown as IWorkflowTaskContext;
		const result = await definition!.run(context, input);

		expect(result).toBe("Saved answer");
		expect(recordInputRequired).toHaveBeenCalledWith("silo-1", "mcp-task-1", initial.callDigest);
		expect(recordCompleted).toHaveBeenCalledWith("silo-1", "mcp-task-1", initial.callDigest, "Saved answer");
		expect(workflow).toBeDefined();
	});
});
