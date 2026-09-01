import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import type { McpTaskRepository } from "../mcp-tasks/mcp-task-repository.types";
import { McpTaskStates } from "../mcp-tasks/mcp-task.types";
import type { McpTaskCaller, McpTaskInputResponse, McpTaskRecord, McpTaskWorkflow } from "../mcp-tasks/mcp-task.types";
import { mcpTaskRouter } from "../routes/mcp-task";

/** Holds the caller-visible task and workflow calls behind request-level route tests. */
interface _Harness
{
	/** Mutable product task returned by the fake repository. */
	task: McpTaskRecord;
	/** Records workflow input delivery after product input commits. */
	deliverInput: (...arguments_: Parameters<McpTaskWorkflow["deliverInput"]>) => void;
	/** Records workflow cancellation after product cancellation commits. */
	cancel: (...arguments_: Parameters<McpTaskWorkflow["cancel"]>) => void;
}

/** Return one saved task with private fields that public responses must omit. */
function _Task(state: McpTaskStates): McpTaskRecord
{
	return {
		id: "mcp-task-1",
		siloId: "silo-a",
		principalId: "principal-a",
		callDigest: `sha256:${"a".repeat(64)}`,
		serverRevisionId: "server-revision-1",
		toolRevisionId: "tool-revision-1",
		toolName: "weather.lookup",
		protocolVersion: "2026-07-28",
		state,
		inputRequest: null,
		inputResponse: null,
		result: null,
		failureCode: null,
		toolInvocationRowId: "tool-invocation-1",
		workflowTask: { taskId: "workflow-task-1", taskName: "mcp-task.call", idempotencyKey: "workflow-key-1" },
	};
}

/** Build the task repository operations used by public GET, input, and cancellation routes. */
function _Repository(harness: _Harness): McpTaskRepository
{
	return {
		async createOrFind() { throw new Error("submission is not used by these route tests"); },
		async ensureWorkflow() { throw new Error("submission is not used by these route tests"); },
		async find(siloId: string, principalId: string, taskId: string)
		{
			return harness.task.siloId === siloId && harness.task.principalId === principalId && harness.task.id === taskId ? { ...harness.task } : null;
		},
		async load() { return { ...harness.task }; },
		async recordInputRequired() { return { ...harness.task }; },
		async recordInput(_siloId: string, _principalId: string, _taskId: string, response: McpTaskInputResponse)
		{
			if (harness.task.state !== McpTaskStates.InputRequired || harness.task.inputRequest?.requestId !== response.requestId)
				return null;
			harness.task = { ...harness.task, state: McpTaskStates.Working, inputResponse: response };
			return { ...harness.task };
		},
		async admitAuthorizedToolInvocation() { return { ...harness.task }; },
		async recordFailure() { return { ...harness.task }; },
		async cancel(siloId: string, principalId: string, taskId: string)
		{
			if (harness.task.siloId !== siloId || harness.task.principalId !== principalId || harness.task.id !== taskId)
				return "not_available";
			if (harness.task.state === McpTaskStates.Running)
				return "too_late";
			harness.task = { ...harness.task, state: McpTaskStates.Cancelled };
			return "cancelled";
		},
	};
}

/** Build an MCP unit of work around the route-test repository. */
function _UnitOfWork(repository: McpTaskRepository): McpOperatorUnitOfWork
{
	const transaction = { mcpTasks: repository, workflowTransaction: { client: {} } } as unknown as McpOperatorTransaction;
	return { execute: async function _Execute<Result>(operation: (value: McpOperatorTransaction) => Promise<Result>): Promise<Result> { return operation(transaction); } };
}

/** Mount the public task router with one selected caller and mutable task. */
function _App(task: McpTaskRecord, caller: McpTaskCaller | null): { readonly app: Express; readonly harness: _Harness }
{
	const harness: _Harness = { task, deliverInput: vi.fn(), cancel: vi.fn() };
	const workflow: McpTaskWorkflow = {
		async admit() { throw new Error("submission is not used by these route tests"); },
		async deliverInput(receipt, input, response): Promise<void> { harness.deliverInput(receipt, input, response); },
		async cancel(receipt): Promise<void> { harness.cancel(receipt); },
	};
	const app = express();
	app.use(express.json());
	app.use("/api/v1/mcp", mcpTaskRouter(_UnitOfWork(_Repository(harness)), workflow, async function _ResolveCaller() { return caller; }));
	return { app, harness };
}

describe("public MCP task routes", function _McpTaskRouterSuite()
{
	it("rejects a task read when no authenticated caller resolves", async function _RejectsUnauthenticatedRead()
	{
		const mounted = _App(_Task(McpTaskStates.Completed), null);

		const response = await request(mounted.app).get("/api/v1/mcp/tasks/mcp-task-1");

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "Authentication required", code: "UNAUTHORIZED" });
	});

	it("does not disclose a task owned by another Principal", async function _HidesAnotherOwner()
	{
		const mounted = _App(_Task(McpTaskStates.Completed), { siloId: "silo-a", principalId: "principal-b" });

		const response = await request(mounted.app).get("/api/v1/mcp/tasks/mcp-task-1");

		expect(response.status).toBe(404);
		expect(response.body.code).toBe("MCP_TASK_NOT_FOUND");
	});

	it("returns completed results without internal ownership or workflow fields", async function _ReturnsCompletedTask()
	{
		const task = { ..._Task(McpTaskStates.Completed), result: { temperature: 24 } };
		const mounted = _App(task, { siloId: "silo-a", principalId: "principal-a" });

		const response = await request(mounted.app).get("/api/v1/mcp/tasks/mcp-task-1");

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ id: "mcp-task-1", state: McpTaskStates.Completed, result: { temperature: 24 }, failureCode: null });
		expect(response.body).not.toHaveProperty("principalId");
		expect(response.body).not.toHaveProperty("workflowTask");
		expect(response.body).not.toHaveProperty("toolInvocationRowId");
	});

	it("returns the saved failure code for a failed task", async function _ReturnsFailedTask()
	{
		const task = { ..._Task(McpTaskStates.Failed), failureCode: "mcp_tool_not_ready" };
		const mounted = _App(task, { siloId: "silo-a", principalId: "principal-a" });

		const response = await request(mounted.app).get("/api/v1/mcp/tasks/mcp-task-1");

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ state: McpTaskStates.Failed, result: null, failureCode: "mcp_tool_not_ready" });
	});

	it("saves matching input before it wakes the bound workflow", async function _SubmitsInput()
	{
		const task = { ..._Task(McpTaskStates.InputRequired), inputRequest: { requestId: "request-1", message: "Which unit?", argumentName: "unit" } };
		const mounted = _App(task, { siloId: "silo-a", principalId: "principal-a" });

		const response = await request(mounted.app).post("/api/v1/mcp/tasks/mcp-task-1/input").send({ requestId: "request-1", value: "celsius" });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ state: McpTaskStates.Working, inputResponse: { requestId: "request-1", value: "celsius" } });
		expect(mounted.harness.deliverInput).toHaveBeenCalledWith(task.workflowTask, { siloId: "silo-a", mcpTaskId: "mcp-task-1", callDigest: task.callDigest }, { requestId: "request-1", value: "celsius" });
	});

	it("cancels the engine task only after product cancellation wins", async function _CancelsTask()
	{
		const task = _Task(McpTaskStates.Working);
		const mounted = _App(task, { siloId: "silo-a", principalId: "principal-a" });

		const response = await request(mounted.app).delete("/api/v1/mcp/tasks/mcp-task-1");

		expect(response.status).toBe(200);
		expect(response.body.state).toBe(McpTaskStates.Cancelled);
		expect(mounted.harness.cancel).toHaveBeenCalledWith(task.workflowTask);
	});
});
