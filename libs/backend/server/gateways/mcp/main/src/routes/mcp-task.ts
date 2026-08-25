import { Router, type Request } from "express";

import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { getMcpTask, submitMcpTask, submitMcpTaskInput } from "../mcp-tasks/mcp-task-submission";
import { McpTaskInputSubmissionOutcomes } from "../mcp-tasks/mcp-task.types";
import type { McpTaskRecord, McpTaskWorkflow } from "../mcp-tasks/mcp-task.types";
import { ___McpTaskIdSchema, ___McpTaskInputResponseSchema, ___McpTaskSubmissionSchema } from "../mcp-tasks/mcp-task.validator";
import { _RequireMcpCaller } from "./mcp-caller";
import type { McpCallerResolver } from "./mcp-caller.types";

/**
 * Creates the caller-owned HTTP API for saved asynchronous MCP tool calls.
 *
 * Called by: `apps/opencrane/src/app/routes.ts`, alongside the MCP operator router at the same
 * `/api/v1/mcp` mount. Each handler resolves a trusted local caller, accepts only validated task
 * data, and returns a redacted task response. Missing callers receive 401; invalid fields receive
 * 400; unavailable caller-owned tasks receive 404; and conflicting retries or input receive 409.
 *
 * @param unitOfWork - Runs task reads and writes in their product database transaction.
 * @param workflow - Admits the saved task and delivers accepted input to its workflow.
 * @param resolveCaller - Resolves verified request evidence to the durable local caller.
 * @returns Express router for creating, reading, and continuing MCP tasks.
 */
export function mcpTaskRouter(unitOfWork: McpOperatorUnitOfWork, workflow: McpTaskWorkflow, resolveCaller: McpCallerResolver): Router
{
  const router = Router();

  /** Saves an asynchronous MCP tool call and starts its background workflow. */
  router.post("/tasks", async function _SubmitTask(req, res)
  {
    const caller = await resolveCaller(req);
    if (!_RequireMcpCaller(res, caller))
      return;
    const parsed = ___McpTaskSubmissionSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "MCP task fields are invalid.", code: "VALIDATION_ERROR" });
      return;
    }
    const task = await submitMcpTask(unitOfWork, workflow, caller, parsed.data);
    if (task === null)
    {
      res.status(409).json({ error: "The task key is already used by different input.", code: "MCP_TASK_CONFLICT" });
      return;
    }
    res.status(201).json(_TaskResponse(task));
  });

  /** Returns a task owned by the authenticated caller. */
  router.get("/tasks/:id", async function _GetTask(req: Request<{ id: string }>, res)
  {
    const caller = await resolveCaller(req);
    if (!_RequireMcpCaller(res, caller))
      return;
    if (!___McpTaskIdSchema.safeParse(req.params.id).success)
    {
      res.status(400).json({ error: "MCP task id is invalid.", code: "VALIDATION_ERROR" });
      return;
    }
    const task = await getMcpTask(unitOfWork, caller, req.params.id);
    if (task === null)
    {
      res.status(404).json({ error: "MCP task not found.", code: "MCP_TASK_NOT_FOUND" });
      return;
    }
    res.json(_TaskResponse(task));
  });

  /** Saves one answer and wakes the background task that requested it. */
  router.post("/tasks/:id/input", async function _SubmitTaskInput(req: Request<{ id: string }>, res)
  {
    const caller = await resolveCaller(req);
    if (!_RequireMcpCaller(res, caller))
      return;
    if (!___McpTaskIdSchema.safeParse(req.params.id).success)
    {
      res.status(400).json({ error: "MCP task id is invalid.", code: "VALIDATION_ERROR" });
      return;
    }
    const parsed = ___McpTaskInputResponseSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "MCP task input fields are invalid.", code: "VALIDATION_ERROR" });
      return;
    }
    const result = await submitMcpTaskInput(unitOfWork, workflow, caller, req.params.id, parsed.data);
    if (result.outcome === McpTaskInputSubmissionOutcomes.NotAvailable)
    {
      res.status(404).json({ error: "MCP task not found.", code: "MCP_TASK_NOT_FOUND" });
      return;
    }
    if (result.outcome === McpTaskInputSubmissionOutcomes.Conflict)
    {
      res.status(409).json({ error: "MCP task input conflicts with saved input.", code: "MCP_TASK_INPUT_CONFLICT" });
      return;
    }
    if (result.task === undefined)
      throw new Error("Accepted MCP task input has no saved task.");
    res.json(_TaskResponse(result.task));
  });

  return router;
}

/** Removes private task ownership and engine details before returning a task to its caller. */
function _TaskResponse(task: McpTaskRecord)
{
  return {
    id: task.id,
    toolName: task.toolName,
    state: task.state,
    inputRequest: task.inputRequest,
    inputResponse: task.inputResponse,
    result: task.result,
    failureCode: task.failureCode,
  };
}
