import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTransaction } from "@opencrane/backend/server/infra/workflows/contract";
import { WorkflowTaskStates } from "@opencrane/backend/server/infra/workflows/contract";
import { __FakeWorkflowEngine } from "@opencrane/backend/server/infra/workflows/testing";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpTaskRepository, McpTaskSubmissionRecord, McpTaskWorkflowBinding } from "../mcp-tasks/mcp-task-repository.types";
import { cancelMcpTask, submitMcpTask, submitMcpTaskInput } from "../mcp-tasks/mcp-task-submission";
import { __CreateMcpTaskWorkflow } from "../mcp-tasks/mcp-task";
import { McpTaskCancellationOutcomes, McpTaskInputSubmissionOutcomes, McpTaskStates } from "../mcp-tasks/mcp-task.types";
import type { McpTaskCaller, McpTaskInputResponse, McpTaskRecord, McpTaskSubmissionCommand } from "../mcp-tasks/mcp-task.types";

/** Mutable task state behind the engine-neutral workflow tests. */
interface _TaskState
{
	task: McpTaskRecord | null;
}

/** Return the authenticated task owner used by every case. */
function _Caller(): McpTaskCaller
{
	return { siloId: "silo-a", principalId: "principal-a" };
}

/** Return one exact installed OCI-backed tool call. */
function _Command(input = false): McpTaskSubmissionCommand
{
	return {
		idempotencyKey: "task-request-1",
		serverRevisionId: "server-revision-1",
		toolRevisionId: "tool-revision-1",
		arguments: { city: "Nairobi" },
		...(input ? { inputRequest: { requestId: "request-1", message: "Which unit?", argumentName: "unit" } } : {}),
	};
}

/** Return an opaque transaction accepted by the fake workflow engine. */
function _WorkflowTransaction(): IWorkflowTransaction
{
	return { client: {} };
}

/** Clone the caller-visible record so tests cannot mutate repository state accidentally. */
function _Record(state: _TaskState): McpTaskRecord | null
{
	return state.task === null ? null : { ...state.task };
}

/** Build only the task persistence operations exercised by this workflow. */
function _Repository(state: _TaskState): McpTaskRepository
{
	return {
		async createOrFind(submission: McpTaskSubmissionRecord)
		{
			if (state.task !== null)
				return state.task.callDigest === submission.callDigest ? { created: false, task: _Record(state) as McpTaskRecord } : null;
			state.task = {
				id: "mcp-task-1",
				siloId: submission.siloId,
				principalId: submission.principalId,
				callDigest: submission.callDigest,
				serverRevisionId: submission.serverRevisionId,
				toolRevisionId: submission.toolRevisionId,
				toolName: "weather.lookup",
				protocolVersion: "2026-07-28",
				state: McpTaskStates.Working,
				inputRequest: submission.inputRequest,
				inputResponse: null,
				result: null,
				failureCode: null,
				toolInvocationRowId: null,
				workflowTask: null,
			};
			return { created: true, task: _Record(state) as McpTaskRecord };
		},
		async ensureWorkflow(_siloId: string, _taskId: string, binding: McpTaskWorkflowBinding)
		{
			if (state.task === null)
				return null;
			state.task = { ...state.task, workflowTask: { taskId: binding.taskId, taskName: binding.taskName, idempotencyKey: binding.taskKey } };
			return _Record(state);
		},
		async find(siloId: string, principalId: string, taskId: string)
		{
			return state.task?.siloId === siloId && state.task.principalId === principalId && state.task.id === taskId ? _Record(state) : null;
		},
		async load(siloId: string, taskId: string, callDigest: string)
		{
			return state.task?.siloId === siloId && state.task.id === taskId && state.task.callDigest === callDigest ? _Record(state) : null;
		},
		async recordInputRequired()
		{
			if (state.task === null)
				return null;
			if (state.task.state === McpTaskStates.Working && state.task.inputRequest !== null && state.task.inputResponse === null)
				state.task = { ...state.task, state: McpTaskStates.InputRequired };
			return _Record(state);
		},
		async recordInput(_siloId: string, _principalId: string, _taskId: string, response: McpTaskInputResponse)
		{
			if (state.task === null || state.task.state !== McpTaskStates.InputRequired || state.task.inputRequest?.requestId !== response.requestId)
				return null;
			state.task = { ...state.task, inputResponse: response, state: McpTaskStates.Working };
			return _Record(state);
		},
		async admitToolInvocation()
		{
			if (state.task === null)
				return null;
			if (state.task.toolInvocationRowId === null)
				state.task = { ...state.task, state: McpTaskStates.Queued, toolInvocationRowId: "tool-invocation-1" };
			return _Record(state);
		},
		async recordFailure(_siloId: string, _taskId: string, _callDigest: string, failureCode: string)
		{
			if (state.task === null)
				return null;
			state.task = { ...state.task, state: McpTaskStates.Failed, failureCode };
			return _Record(state);
		},
		async cancel()
		{
			if (state.task === null)
				return "not_available";
			if (state.task.state === McpTaskStates.Running)
				return "too_late";
			state.task = { ...state.task, state: McpTaskStates.Cancelled };
			return "cancelled";
		},
	};
}

/** Bind the fake repository to the same transaction shape production composition supplies. */
function _UnitOfWork(state: _TaskState): McpOperatorUnitOfWork
{
	const transaction = { mcpTasks: _Repository(state), workflowTransaction: _WorkflowTransaction() } as unknown as McpOperatorTransaction;
	return { execute: async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return operation(transaction); } };
}

describe("public MCP task workflow", function _McpTaskSuite()
{
	it("deduplicates admission and invokes the exact OCI runtime command once", async function _RunsOnce()
	{
		const state: _TaskState = { task: null };
		const execution = new __FakeWorkflowEngine();
		const runtime = { admitInvocation: vi.fn().mockImplementation(async function _Admit(invocationId: string)
		{
			expect(invocationId).toBe("tool-invocation-1");
			state.task = { ...(state.task as McpTaskRecord), state: McpTaskStates.Completed, result: { temperature: 24 } };
			return "admitted" as const;
		}) };
		const unitOfWork = _UnitOfWork(state);
		const workflow = __CreateMcpTaskWorkflow({ execution, unitOfWork, runtime, statusPollMilliseconds: 250 });
		const first = await submitMcpTask(unitOfWork, workflow, _Caller(), _Command());
		const replay = await submitMcpTask(unitOfWork, workflow, _Caller(), _Command());

		await execution.startWorkers({ workerName: "mcp-task-test" });

		expect(first?.id).toBe("mcp-task-1");
		expect(replay?.workflowTask).toEqual(first?.workflowTask);
		expect(runtime.admitInvocation).toHaveBeenCalledTimes(1);
		expect(execution.taskSnapshot(first?.workflowTask as NonNullable<McpTaskRecord["workflowTask"]>).result).toEqual({ mcpTaskId: "mcp-task-1", state: McpTaskStates.Completed });
	});

	it("resumes the same waiting task only after its matching response is saved", async function _ResumesInput()
	{
		const state: _TaskState = { task: null };
		const execution = new __FakeWorkflowEngine();
		const runtime = { admitInvocation: vi.fn().mockImplementation(async function _Admit()
		{
			state.task = { ...(state.task as McpTaskRecord), state: McpTaskStates.Completed, result: { unit: state.task?.inputResponse?.value ?? null } };
			return "admitted" as const;
		}) };
		const unitOfWork = _UnitOfWork(state);
		const workflow = __CreateMcpTaskWorkflow({ execution, unitOfWork, runtime, statusPollMilliseconds: 250 });
		const task = await submitMcpTask(unitOfWork, workflow, _Caller(), _Command(true));
		const workers = execution.startWorkers({ workerName: "mcp-task-input-test" });
		await vi.waitFor(function _WaitForInput(): void { expect(state.task?.state).toBe(McpTaskStates.InputRequired); });

		const response = await submitMcpTaskInput(unitOfWork, workflow, _Caller(), task?.id as string, { requestId: "request-1", value: "celsius" });
		await workers;

		expect(response.outcome).toBe(McpTaskInputSubmissionOutcomes.Accepted);
		expect(response.task?.id).toBe(task?.id);
		expect(runtime.admitInvocation).toHaveBeenCalledTimes(1);
		expect(state.task).toMatchObject({ state: McpTaskStates.Completed, inputResponse: { requestId: "request-1", value: "celsius" } });
		const replay = await submitMcpTaskInput(unitOfWork, workflow, _Caller(), task?.id as string, { requestId: "request-1", value: "celsius" });
		expect(replay.outcome).toBe(McpTaskInputSubmissionOutcomes.Accepted);
		expect(runtime.admitInvocation).toHaveBeenCalledTimes(1);
	});

	it("retries event delivery after the input response was saved", async function _RetriesInputDelivery()
	{
		const state: _TaskState = { task: null };
		const execution = new __FakeWorkflowEngine();
		const runtime = { admitInvocation: vi.fn().mockImplementation(async function _Admit()
		{
			state.task = { ...(state.task as McpTaskRecord), state: McpTaskStates.Completed, result: { unit: state.task?.inputResponse?.value ?? null } };
			return "admitted" as const;
		}) };
		const unitOfWork = _UnitOfWork(state);
		const baseWorkflow = __CreateMcpTaskWorkflow({ execution, unitOfWork, runtime, statusPollMilliseconds: 250 });
		const deliverInput = vi.fn().mockImplementationOnce(async function _FailDelivery(): Promise<void>
		{
			throw new Error("temporary event delivery failure");
		}).mockImplementation(baseWorkflow.deliverInput);
		const workflow = { ...baseWorkflow, deliverInput };
		const task = await submitMcpTask(unitOfWork, workflow, _Caller(), _Command(true));
		const workers = execution.startWorkers({ workerName: "mcp-task-input-retry-test" });
		await vi.waitFor(function _WaitForInput(): void { expect(state.task?.state).toBe(McpTaskStates.InputRequired); });

		await expect(submitMcpTaskInput(unitOfWork, workflow, _Caller(), task?.id as string, { requestId: "request-1", value: "celsius" })).rejects.toThrow("temporary event delivery failure");
		expect(state.task).toMatchObject({ state: McpTaskStates.Working, inputResponse: { requestId: "request-1", value: "celsius" } });

		const retry = await submitMcpTaskInput(unitOfWork, workflow, _Caller(), task?.id as string, { requestId: "request-1", value: "celsius" });
		await workers;

		expect(retry.outcome).toBe(McpTaskInputSubmissionOutcomes.Accepted);
		expect(deliverInput).toHaveBeenCalledTimes(2);
		expect(runtime.admitInvocation).toHaveBeenCalledTimes(1);
		expect(state.task).toMatchObject({ state: McpTaskStates.Completed, result: { unit: "celsius" } });
	});

	it("cancels the saved task and its workflow before provider dispatch", async function _CancelsBeforeDispatch()
	{
		const state: _TaskState = { task: null };
		const execution = new __FakeWorkflowEngine();
		const runtime = { admitInvocation: vi.fn() };
		const unitOfWork = _UnitOfWork(state);
		const workflow = __CreateMcpTaskWorkflow({ execution, unitOfWork, runtime, statusPollMilliseconds: 250 });
		const task = await submitMcpTask(unitOfWork, workflow, _Caller(), _Command());

		const cancelled = await cancelMcpTask(unitOfWork, workflow, _Caller(), task?.id as string);

		expect(cancelled.outcome).toBe(McpTaskCancellationOutcomes.Cancelled);
		expect(cancelled.task?.state).toBe(McpTaskStates.Cancelled);
		expect(execution.taskSnapshot(task?.workflowTask as NonNullable<McpTaskRecord["workflowTask"]>).state).toBe(WorkflowTaskStates.Cancelled);
		expect(runtime.admitInvocation).not.toHaveBeenCalled();
	});
});
