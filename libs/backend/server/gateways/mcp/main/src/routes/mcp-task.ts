import { Router, type Request } from "express";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { cancelMcpTask, getMcpTask, submitMcpTask, submitMcpTaskInput } from "../mcp-tasks/mcp-task-submission";
import { McpTaskCancellationOutcomes, McpTaskInputSubmissionOutcomes } from "../mcp-tasks/mcp-task.types";
import type { McpTaskRecord, McpTaskWorkflow } from "../mcp-tasks/mcp-task.types";
import { ___McpTaskIdSchema, ___McpTaskInputResponseSchema, ___McpTaskSubmissionSchema } from "../mcp-tasks/mcp-task.validator";
import { _RequireMcpCaller } from "./mcp-caller";
import type { McpCallerResolver } from "./mcp-caller.types";

/** Create the authenticated API for durable OCI-backed MCP tasks. */
export function mcpTaskRouter(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, resolveCaller: McpCallerResolver): Router
{
	const router = Router();

	router.post("/tasks", async function _Submit(request, response): Promise<void>
	{
		const caller = await resolveCaller(request);
		if (!_RequireMcpCaller(response, caller))
			return;
		const parsed = ___McpTaskSubmissionSchema.safeParse(request.body);
		if (!parsed.success)
		{
			_Problem(response, 400, "VALIDATION_ERROR", "MCP task fields are invalid");
			return;
		}
		const task = await submitMcpTask(unitOfWork, workflow, caller, parsed.data);
		if (task === null)
		{
			_Problem(response, 409, "MCP_TASK_CONFLICT", "MCP task selection or retry conflicts with saved authority");
			return;
		}
		response.status(201).json(_TaskResponse(task));
	});

	router.get("/tasks/:id", async function _Get(request: Request<{ id: string }>, response): Promise<void>
	{
		const caller = await resolveCaller(request);
		if (!_RequireMcpCaller(response, caller))
			return;
		if (!___McpTaskIdSchema.safeParse(request.params.id).success)
		{
			_Problem(response, 400, "VALIDATION_ERROR", "MCP task id is invalid");
			return;
		}
		const task = await getMcpTask(unitOfWork, caller, request.params.id);
		if (task === null)
		{
			_Problem(response, 404, "MCP_TASK_NOT_FOUND", "MCP task not found");
			return;
		}
		response.json(_TaskResponse(task));
	});

	router.post("/tasks/:id/input", async function _Input(request: Request<{ id: string }>, response): Promise<void>
	{
		const caller = await resolveCaller(request);
		if (!_RequireMcpCaller(response, caller))
			return;
		const parsed = ___McpTaskInputResponseSchema.safeParse(request.body);
		if (!___McpTaskIdSchema.safeParse(request.params.id).success || !parsed.success)
		{
			_Problem(response, 400, "VALIDATION_ERROR", "MCP task input is invalid");
			return;
		}
		const result = await submitMcpTaskInput(unitOfWork, workflow, caller, request.params.id, parsed.data);
		if (result.outcome === McpTaskInputSubmissionOutcomes.NotAvailable)
		{
			_Problem(response, 404, "MCP_TASK_NOT_FOUND", "MCP task not found");
			return;
		}
		if (result.outcome === McpTaskInputSubmissionOutcomes.Conflict || result.task === undefined)
		{
			_Problem(response, 409, "MCP_TASK_INPUT_CONFLICT", "MCP task input conflicts with saved input");
			return;
		}
		response.json(_TaskResponse(result.task));
	});

	router.delete("/tasks/:id", async function _Cancel(request: Request<{ id: string }>, response): Promise<void>
	{
		const caller = await resolveCaller(request);
		if (!_RequireMcpCaller(response, caller))
			return;
		if (!___McpTaskIdSchema.safeParse(request.params.id).success)
		{
			_Problem(response, 400, "VALIDATION_ERROR", "MCP task id is invalid");
			return;
		}
		const result = await cancelMcpTask(unitOfWork, workflow, caller, request.params.id);
		if (result.outcome === McpTaskCancellationOutcomes.NotAvailable)
		{
			_Problem(response, 404, "MCP_TASK_NOT_FOUND", "MCP task not found");
			return;
		}
		if (result.outcome === McpTaskCancellationOutcomes.TooLate || result.task === undefined)
		{
			_Problem(response, 409, "MCP_TASK_ALREADY_RUNNING", "MCP task provider dispatch already started");
			return;
		}
		response.json(_TaskResponse(result.task));
	});

	return router;
}

/** Remove ownership, arguments, workflow receipts, and internal ToolInvocation ids from the response. */
function _TaskResponse(task: McpTaskRecord)
{
	return { id: task.id, serverRevisionId: task.serverRevisionId, toolRevisionId: task.toolRevisionId, toolName: task.toolName, protocolVersion: task.protocolVersion, state: task.state, inputRequest: task.inputRequest, inputResponse: task.inputResponse, result: task.result, failureCode: task.failureCode };
}

/** Send one stable public problem shape. */
function _Problem(response: import("express").Response, status: number, code: string, error: string): void
{
	response.status(status).json({ error, code });
}
