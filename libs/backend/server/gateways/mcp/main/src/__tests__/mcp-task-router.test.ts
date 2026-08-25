import express from "express";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { McpOperatorTransaction, McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpTaskStates } from "../mcp-tasks/mcp-task.types";
import type { McpTaskRecord, McpTaskWorkflow } from "../mcp-tasks/mcp-task.types";
import type { McpCallerResolver } from "../routes/mcp-caller.types";
import { mcpTaskRouter } from "../routes/mcp-task";

/** Builds one saved task with private fields that the public route must not return. */
function _Task(overrides: Partial<McpTaskRecord> = {}): McpTaskRecord
{
  return {
    id: "task-1",
    siloId: "silo-1",
    principalId: "principal-1",
    callDigest: "sha256:private-call-digest",
    toolName: "collect-details",
    state: McpTaskStates.InputRequired,
    inputRequest: { requestId: "details", message: "What details should this task use?" },
    inputResponse: null,
    result: null,
    failureCode: null,
    workflowTask: { taskId: "engine-task-1", taskName: "mcp-task.call", idempotencyKey: "workflows:mcp-task:task-1" },
    ...overrides,
  };
}

/** Wraps a task repository in the same transaction callback shape used by task lifecycle code. */
function _UnitOfWork(mcpTasks: Record<string, unknown>): McpOperatorUnitOfWork
{
  return {
    async execute<Result>(operation: (transaction: McpOperatorTransaction) => Promise<Result>): Promise<Result>
    {
      return await operation({ mcpTasks, workflowTransaction: {} } as unknown as McpOperatorTransaction);
    },
  };
}

const _ResolveCaller: McpCallerResolver = async function _Caller()
{
  return { siloId: "silo-1", principalId: "principal-1" };
};

/** Mounts the task router with a durable local caller resolved by the trusted request boundary. */
function _App(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, resolveCaller: McpCallerResolver = _ResolveCaller): Express
{
  const app = express();
  app.use(express.json());
  app.use("/api/v1/mcp", mcpTaskRouter(unitOfWork, workflow, resolveCaller));
  return app;
}

/** Supplies an admitted workflow receipt and records input delivery. */
function _Workflow(): McpTaskWorkflow
{
  return {
    admit: vi.fn().mockResolvedValue({ taskKey: "workflows:mcp-task:task-1", receipt: { taskId: "engine-task-1", taskName: "mcp-task.call", idempotencyKey: "workflows:mcp-task:task-1" } }),
    deliverInput: vi.fn().mockResolvedValue(undefined),
  };
}

describe("mcp-task router", function _suite()
{
	it("requires a local caller before it saves a task", async function _RejectsAnonymousSubmission()
	{
		const createOrFind = vi.fn();
		const response = await request(_App(_UnitOfWork({ createOrFind }), _Workflow(), async function _Anonymous()
		{
			return null;
		}))
			.post("/api/v1/mcp/tasks")
			.send({ idempotencyKey: "call-1", toolName: "collect-details", arguments: {}, inputRequest: { requestId: "details", message: "What details should this task use?" } });

		expect(response.status).toBe(401);
		expect(createOrFind).not.toHaveBeenCalled();
	});

	it("rejects malformed task input before task persistence", async function _RejectsMalformedSubmission()
	{
		const createOrFind = vi.fn();
		const response = await request(_App(_UnitOfWork({ createOrFind }), _Workflow()))
			.post("/api/v1/mcp/tasks")
			.send({ idempotencyKey: "call-1", toolName: "collect-details", inputRequest: { requestId: "details", message: "What details should this task use?" } });

		expect(response.status).toBe(400);
		expect(createOrFind).not.toHaveBeenCalled();
	});

	it("saves a task and returns only its caller-visible progress", async function _SubmitsTask()
	{
		const saved = _Task();
		const response = await request(_App(_UnitOfWork({ createOrFind: vi.fn().mockResolvedValue({ created: true, task: _Task({ workflowTask: null }) }), ensureWorkflow: vi.fn().mockResolvedValue(saved) }), _Workflow()))
			.post("/api/v1/mcp/tasks")
			.send({ idempotencyKey: "call-1", toolName: "collect-details", arguments: { source: "client" }, inputRequest: { requestId: "details", message: "What details should this task use?" } });

		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ id: "task-1", toolName: "collect-details", state: "input_required" });
		expect(response.body).not.toHaveProperty("workflowTask");
	});

	it("returns a caller-owned saved task without product ownership or engine details", async function _RedactsTask()
  {
    const task = _Task();
    const response = await request(_App(_UnitOfWork({ find: vi.fn().mockResolvedValue(task) }), _Workflow()))
      .get("/api/v1/mcp/tasks/task-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "task-1", toolName: "collect-details", state: "input_required", inputRequest: { requestId: "details", message: "What details should this task use?" }, inputResponse: null, result: null, failureCode: null });
    expect(response.body).not.toHaveProperty("siloId");
    expect(response.body).not.toHaveProperty("principalId");
    expect(response.body).not.toHaveProperty("callDigest");
    expect(response.body).not.toHaveProperty("workflowTask");
  });

	it("does not reveal whether an unavailable task belongs to another caller", async function _HidesUnavailableTask()
	{
		const response = await request(_App(_UnitOfWork({ find: vi.fn().mockResolvedValue(null) }), _Workflow()))
			.get("/api/v1/mcp/tasks/task-1");

		expect(response.status).toBe(404);
		expect(response.body).toMatchObject({ code: "MCP_TASK_NOT_FOUND" });
	});

  it("saves accepted input before delivering it to the admitted workflow", async function _DeliversInput()
  {
    const workflow = _Workflow();
    const waiting = _Task();
    const saved = _Task({ inputResponse: { requestId: "details", value: "Use the signed brief." } });
    const response = await request(_App(_UnitOfWork({ find: vi.fn().mockResolvedValue(waiting), recordInput: vi.fn().mockResolvedValue(saved) }), workflow))
      .post("/api/v1/mcp/tasks/task-1/input")
      .send({ requestId: "details", value: "Use the signed brief." });

    expect(response.status).toBe(200);
    expect(vi.mocked(workflow.deliverInput)).toHaveBeenCalledWith(waiting.workflowTask, { siloId: "silo-1", mcpTaskId: "task-1", callDigest: "sha256:private-call-digest" }, { requestId: "details", value: "Use the signed brief." });
  });
});
