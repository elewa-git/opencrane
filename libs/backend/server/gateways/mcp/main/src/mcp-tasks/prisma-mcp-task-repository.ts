import { createHash } from "node:crypto";

import { McpTaskState, Prisma } from "@prisma/client";
import type { McpTask as PrismaMcpTask } from "@prisma/client";

import { McpTaskStates } from "./mcp-task.types";
import type { McpTaskInputRequest, McpTaskInputResponse, McpTaskRecord } from "./mcp-task.types";
import type { McpTaskCreateResult, McpTaskRepository, McpTaskSubmissionRecord, McpTaskWorkflowBinding } from "./mcp-task-repository.types";

/** Product fields returned by every MCP task repository operation. */
const _TASK_SELECT = { id: true, siloId: true, principalId: true, requestKeyDigest: true, callDigest: true, toolName: true, taskId: true, taskName: true, taskKey: true, state: true, inputRequest: true, inputResponse: true, result: true, failureCode: true } as const satisfies Prisma.McpTaskSelect;

/** Represents the fields selected for an MCP task repository operation. */
type _TaskProjection = Prisma.McpTaskGetPayload<{ select: typeof _TASK_SELECT }>;

/** Turn a request-key digest into a distinct claim identity. */
function _ClaimDigest(requestKeyDigest: string): string
{
	return `sha256:${createHash("sha256").update(`mcp-task:${requestKeyDigest}`).digest("hex")}`;
}

/** Returns a stored input request when its JSON value has the required fields. */
function _InputRequest(value: Prisma.JsonValue | null): McpTaskInputRequest | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	if (typeof value.requestId !== "string" || typeof value.message !== "string")
		return null;
	return { requestId: value.requestId, message: value.message };
}

/** Returns a stored input response when its JSON value has the required fields. */
function _InputResponse(value: Prisma.JsonValue | null): McpTaskInputResponse | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	if (typeof value.requestId !== "string" || typeof value.value !== "string")
		return null;
	return { requestId: value.requestId, value: value.value };
}

/** Translate the database value before task callers branch on it. */
function _State(value: McpTaskState): McpTaskStates
{
	if (value === "Working")
		return McpTaskStates.Working;
	if (value === "InputRequired")
		return McpTaskStates.InputRequired;
	if (value === "Completed")
		return McpTaskStates.Completed;
	if (value === "Cancelled")
		return McpTaskStates.Cancelled;
	if (value === "Failed")
		return McpTaskStates.Failed;
	throw new Error("MCP task has an unknown state.");
}

/** Maps a selected Prisma record into the public MCP task contract. */
function _Record(value: _TaskProjection): McpTaskRecord
{
	const inputRequest = _InputRequest(value.inputRequest);
	const inputResponse = _InputResponse(value.inputResponse);
	if (inputRequest === null)
		throw new Error("MCP task has an invalid input request.");
	if (value.taskId === null || value.taskName === null || value.taskKey === null)
	{
		return { id: value.id, siloId: value.siloId, principalId: value.principalId, callDigest: value.callDigest, toolName: value.toolName, state: _State(value.state), inputRequest, inputResponse, result: value.result, failureCode: value.failureCode, workflowTask: null };
	}
	return { id: value.id, siloId: value.siloId, principalId: value.principalId, callDigest: value.callDigest, toolName: value.toolName, state: _State(value.state), inputRequest, inputResponse, result: value.result, failureCode: value.failureCode, workflowTask: { taskId: value.taskId, taskName: value.taskName, idempotencyKey: value.taskKey } };
}

/**
 * Implements MCP task persistence within the Prisma transaction supplied by the unit of work.
 *
 * The adapter serializes callers that reuse a request key, verifies immutable task and workflow
 * facts on replay, and returns no record when a caller cannot read or change it. The transaction
 * owner constructs this adapter for every MCP operation; it must not be reused after that
 * transaction finishes.
 *
 * @implements McpTaskRepository
 */
export class PrismaMcpTaskRepository implements McpTaskRepository
{
	/** Database transaction shared with task admission and product writes. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Create an adapter bound to one existing database transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }

	/** Creates a task or returns a retry after its claim serializes concurrent request-key use. */
	async createOrFind(submission: McpTaskSubmissionRecord): Promise<McpTaskCreateResult | null>
	{
		await this._transaction.mcpTaskClaim.upsert({
			where: { siloId_identityDigest: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.requestKeyDigest) } },
			create: { siloId: submission.siloId, identityDigest: _ClaimDigest(submission.requestKeyDigest) },
			update: { touchedAt: new Date() },
			select: { identityDigest: true },
		});
		const existing = await this._transaction.mcpTask.findUnique({ where: { siloId_requestKeyDigest: { siloId: submission.siloId, requestKeyDigest: submission.requestKeyDigest } }, select: _TASK_SELECT });
		if (existing !== null)
		{
			const task = _Record(existing);
			return existing.callDigest === submission.callDigest && existing.principalId === submission.principalId ? { created: false, task } : null;
		}
		const task = await this._transaction.mcpTask.create({ data: { ...submission, inputRequest: { requestId: submission.inputRequest.requestId, message: submission.inputRequest.message } }, select: _TASK_SELECT });
		return { created: true, task: _Record(task) };
	}

	/** Binds an admitted task while refusing a retry that would replace saved engine facts. */
	async ensureWorkflow(siloId: string, taskId: string, binding: McpTaskWorkflowBinding): Promise<McpTaskRecord | null>
	{
		const existing = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId }, select: _TASK_SELECT });
		if (existing === null)
			return null;
		if (existing.taskId !== null || existing.taskName !== null || existing.taskKey !== null)
		{
			if (existing.taskId !== binding.taskId || existing.taskName !== binding.taskName || existing.taskKey !== binding.taskKey)
				return null;
			return _Record(existing);
		}
		const updated = await this._transaction.mcpTask.update({ where: { id: taskId }, data: binding, select: _TASK_SELECT });
		return _Record(updated);
	}

	/** Find one task only for the principal that created it. */
	async find(siloId: string, principalId: string, taskId: string): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, principalId }, select: _TASK_SELECT });
		return task === null ? null : _Record(task);
	}

	/** Load the task a workflow was admitted to handle. */
	async load(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, callDigest }, select: _TASK_SELECT });
		return task === null ? null : _Record(task);
	}

	/** Moves a working task to `InputRequired` without replacing a response saved by a replay. */
	async recordInputRequired(siloId: string, taskId: string, callDigest: string): Promise<McpTaskRecord | null>
	{
		await this._transaction.mcpTask.updateMany({ where: { id: taskId, siloId, callDigest, state: McpTaskState.Working, inputResponse: { equals: Prisma.DbNull } }, data: { state: McpTaskState.InputRequired } });
		return await this.load(siloId, taskId, callDigest);
	}

	/** Saves an answer that matches the waiting request and preserves an identical replay. */
	async recordInput(siloId: string, principalId: string, taskId: string, response: McpTaskInputResponse): Promise<McpTaskRecord | null>
	{
		const task = await this._transaction.mcpTask.findFirst({ where: { id: taskId, siloId, principalId }, select: _TASK_SELECT });
		if (task === null)
			return null;
		const request = _InputRequest(task.inputRequest);
		const storedResponse = _InputResponse(task.inputResponse);
		if (request === null || request.requestId !== response.requestId)
			return null;
		if (storedResponse !== null)
		{
			if (storedResponse.value !== response.value)
				return null;
			return _Record(task);
		}
		if (task.state !== McpTaskState.InputRequired)
			return null;
		const updated = await this._transaction.mcpTask.updateMany({ where: { id: taskId, state: McpTaskState.InputRequired, inputResponse: { equals: Prisma.DbNull } }, data: { inputResponse: { requestId: response.requestId, value: response.value } } });
		if (updated.count !== 1)
			return null;
		const saved = await this._transaction.mcpTask.findUnique({ where: { id: taskId }, select: _TASK_SELECT });
		return saved === null ? null : _Record(saved);
	}

	/** Saves a completed result and returns the record that survived a replay race. */
	async recordCompleted(siloId: string, taskId: string, callDigest: string, result: string): Promise<McpTaskRecord | null>
	{
		await this._transaction.mcpTask.updateMany({ where: { id: taskId, siloId, callDigest, state: { in: [McpTaskState.Working, McpTaskState.InputRequired] } }, data: { state: McpTaskState.Completed, result, failureCode: null } });
		return await this.load(siloId, taskId, callDigest);
	}
}
