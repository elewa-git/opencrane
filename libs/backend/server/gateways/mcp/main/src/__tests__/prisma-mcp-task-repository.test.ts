import { McpApprovalStatus, McpExecutorCommandState, McpExecutorWorkloadState, McpServerRevisionState, McpServerStatus, McpTaskState, Prisma, ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { MCP_ERA_PROTOCOL_VERSION } from "../era-probe/mcp-era-probe.types";
import type { McpTaskSubmissionRecord } from "../mcp-tasks/mcp-task-repository.types";
import { McpTaskStates } from "../mcp-tasks/mcp-task.types";
import { PrismaMcpTaskRepository } from "../mcp-tasks/prisma-mcp-task-repository";

/** Return the immutable public call submitted by every repository test. */
function _Submission(): McpTaskSubmissionRecord
{
	return {
		siloId: "silo-1",
		principalId: "principal-1",
		requestKeyDigest: `sha256:${"a".repeat(64)}`,
		callDigest: `sha256:${"b".repeat(64)}`,
		serverRevisionId: "server-revision-1",
		toolRevisionId: "tool-revision-1",
		arguments: { city: "Nairobi" },
		inputRequest: null,
	};
}

/** Return one selected Prisma task row with optional lifecycle overrides. */
function _Task(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	const submission = _Submission();
	return {
		id: "mcp-task-1",
		siloId: submission.siloId,
		principalId: submission.principalId,
		requestKeyDigest: submission.requestKeyDigest,
		callDigest: submission.callDigest,
		serverRevisionId: submission.serverRevisionId,
		toolRevisionId: submission.toolRevisionId,
		protocolVersion: MCP_ERA_PROTOCOL_VERSION,
		arguments: submission.arguments,
		taskId: null,
		taskName: null,
		taskKey: null,
		state: McpTaskState.Working,
		inputRequest: null,
		inputResponse: null,
		result: null,
		failureCode: null,
		toolRevision: { name: "weather.current", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false } },
		toolInvocation: null,
		...overrides,
	};
}

describe("Prisma MCP task admission", function _McpTaskAdmissionSuite()
{
	it("selects the exact installed tool on the immutable Ready OCI server revision", async function _SelectsExactOciTool()
	{
		const submission = _Submission();
		const findTool = vi.fn().mockResolvedValue({ inputSchema: (_Task().toolRevision as { inputSchema: object }).inputSchema });
		const createTask = vi.fn().mockResolvedValue(_Task());
		const transaction = {
			mcpTaskClaim: { upsert: vi.fn().mockResolvedValue({ identityDigest: "claim" }) },
			mcpTask: { findUnique: vi.fn().mockResolvedValue(null), create: createTask },
			mcpToolRevision: { findFirst: findTool },
		} as unknown as Prisma.TransactionClient;

		const repository = new PrismaMcpTaskRepository(transaction);
		await expect(repository.createOrFind(submission)).resolves.toMatchObject({ created: true, task: { id: "mcp-task-1", serverRevisionId: submission.serverRevisionId, toolRevisionId: submission.toolRevisionId, toolName: "weather.current" } });

		expect(findTool).toHaveBeenCalledWith({
			where: {
				id: submission.toolRevisionId,
				siloId: submission.siloId,
				serverRevisionId: submission.serverRevisionId,
				serverRevision: {
					is: {
						state: McpServerRevisionState.Ready,
						protocolVersion: MCP_ERA_PROTOCOL_VERSION,
						server: { is: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published, installs: { some: { principalId: submission.principalId } } } },
					},
				},
			},
			select: { inputSchema: true },
		});
		expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ serverRevisionId: submission.serverRevisionId, toolRevisionId: submission.toolRevisionId, protocolVersion: MCP_ERA_PROTOCOL_VERSION }) }));
	});

	it("creates one task-owned ToolInvocation and replays its saved ownership", async function _ReplaysToolInvocation()
	{
		const queued = _Task({ state: McpTaskState.Queued, toolInvocation: { id: "invocation-1", state: ToolInvocationState.Ready, mcpRuntimeExecution: null } });
		const findFirst = vi.fn().mockResolvedValueOnce(_Task()).mockResolvedValueOnce(queued);
		const createInvocation = vi.fn().mockResolvedValue({ id: "invocation-1" });
		const updateTask = vi.fn().mockResolvedValue(queued);
		const transaction = { mcpTask: { findFirst, update: updateTask }, toolInvocation: { create: createInvocation } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);
		const submission = _Submission();

		await expect(repository.admitToolInvocation(submission.siloId, "mcp-task-1", submission.callDigest)).resolves.toMatchObject({ state: McpTaskStates.Queued, toolInvocationRowId: "invocation-1" });
		await expect(repository.admitToolInvocation(submission.siloId, "mcp-task-1", submission.callDigest)).resolves.toMatchObject({ state: McpTaskStates.Queued, toolInvocationRowId: "invocation-1" });

		expect(createInvocation).toHaveBeenCalledOnce();
		expect(createInvocation).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mcpTaskId: "mcp-task-1", toolRevisionId: submission.toolRevisionId, state: ToolInvocationState.Ready, approvalRequired: false }) }));
		expect(updateTask).toHaveBeenCalledOnce();
	});
});

describe("Prisma MCP task input", function _McpTaskInputSuite()
{
	it("accepts one input receipt and replays only the same saved value", async function _ReplaysInputReceipt()
	{
		const inputRequest = { requestId: "input-1", message: "Which unit?", argumentName: "unit" };
		const waiting = _Task({ state: McpTaskState.InputRequired, inputRequest });
		const resumed = _Task({ state: McpTaskState.Working, inputRequest, inputResponse: { requestId: "input-1", value: "celsius" } });
		const findFirst = vi.fn().mockResolvedValueOnce(waiting).mockResolvedValueOnce(resumed).mockResolvedValueOnce(resumed).mockResolvedValueOnce(resumed);
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpTask: { findFirst, updateMany } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);

		await expect(repository.recordInput("silo-1", "principal-1", "mcp-task-1", { requestId: "input-1", value: "celsius" })).resolves.toMatchObject({ state: McpTaskStates.Working, inputResponse: { requestId: "input-1", value: "celsius" } });
		await expect(repository.recordInput("silo-1", "principal-1", "mcp-task-1", { requestId: "input-1", value: "celsius" })).resolves.toMatchObject({ inputResponse: { value: "celsius" } });
		await expect(repository.recordInput("silo-1", "principal-1", "mcp-task-1", { requestId: "input-1", value: "fahrenheit" })).resolves.toBeNull();

		expect(updateMany).toHaveBeenCalledOnce();
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "mcp-task-1", state: McpTaskState.InputRequired, inputResponse: { equals: Prisma.DbNull } }, data: { inputResponse: { requestId: "input-1", value: "celsius" }, state: McpTaskState.Working } });
	});
});

describe("Prisma MCP task cancellation", function _McpTaskCancellationSuite()
{
	it("closes only pending executor and invocation work before cancelling the task", async function _CancelsPendingWork()
	{
		const execution = { id: "execution-1", commandState: McpExecutorCommandState.Pending, workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, deliveryCount: 0, claimedAt: null, claimExpiresAt: null };
		const task = _Task({ state: McpTaskState.Queued, toolInvocation: { id: "invocation-1", state: ToolInvocationState.Ready, mcpRuntimeExecution: execution } });
		const executionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const invocationUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const taskUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpTask: { findFirst: vi.fn().mockResolvedValue(task), updateMany: taskUpdate }, mcpRuntimeExecution: { updateMany: executionUpdate }, toolInvocation: { updateMany: invocationUpdate } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);

		await expect(repository.cancel("silo-1", "principal-1", "mcp-task-1")).resolves.toBe("cancelled");

		expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: execution.id, toolInvocationId: "invocation-1", commandState: McpExecutorCommandState.Pending, workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, deliveryCount: 0, claimedAt: null, claimExpiresAt: null }, data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed }) }));
		expect(invocationUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "invocation-1", state: ToolInvocationState.Ready }, data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "mcp_task_cancelled" }) }));
		expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "mcp-task-1", state: { in: [McpTaskState.Working, McpTaskState.InputRequired, McpTaskState.Queued] } }, data: expect.objectContaining({ state: McpTaskState.Cancelled }) }));
	});

	it("keeps an in-flight controller claim pending until late Job assignment can expose cleanup", async function _PreservesInFlightAssignment()
	{
		const claimedAt = new Date("2026-08-29T00:00:00.000Z");
		const claimExpiresAt = new Date("2026-08-29T00:00:30.000Z");
		const execution = { id: "execution-1", commandState: McpExecutorCommandState.Pending, workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, deliveryCount: 1, claimedAt, claimExpiresAt };
		const task = _Task({ state: McpTaskState.Queued, toolInvocation: { id: "invocation-1", state: ToolInvocationState.Ready, mcpRuntimeExecution: execution } });
		const executionUpdate = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { mcpTask: { findFirst: vi.fn().mockResolvedValue(task), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, mcpRuntimeExecution: { updateMany: executionUpdate }, toolInvocation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);

		await expect(repository.cancel("silo-1", "principal-1", "mcp-task-1")).resolves.toBe("cancelled");

		expect(executionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: execution.id, toolInvocationId: "invocation-1", commandState: McpExecutorCommandState.Pending, workloadState: McpExecutorWorkloadState.Pending, workloadUid: null, deliveryCount: 1, claimedAt, claimExpiresAt }, data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Pending, terminalOutcome: "mcp_task_cancelled" }) }));
	});

	it("refuses cancellation after the provider-effect claim starts", async function _RefusesClaimedWork()
	{
		const task = _Task({ state: McpTaskState.Running, toolInvocation: { id: "invocation-1", state: ToolInvocationState.Claimed, mcpRuntimeExecution: null } });
		const taskUpdate = vi.fn();
		const transaction = { mcpTask: { findFirst: vi.fn().mockResolvedValue(task), updateMany: taskUpdate }, mcpRuntimeExecution: { updateMany: vi.fn() }, toolInvocation: { updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);

		await expect(repository.cancel("silo-1", "principal-1", "mcp-task-1")).resolves.toBe("too_late");
		expect(taskUpdate).not.toHaveBeenCalled();
	});
});

describe("Prisma MCP task terminal projection", function _McpTaskTerminalProjectionSuite()
{
	it("projects checked results and bounded failures without changing their terminal state", async function _ProjectsTerminalRows()
	{
		const findFirst = vi.fn()
			.mockResolvedValueOnce(_Task({ state: McpTaskState.Completed, result: { temperature: 24 } }))
			.mockResolvedValueOnce(_Task({ state: McpTaskState.Failed, failureCode: "mcp_tool_failed" }));
		const transaction = { mcpTask: { findFirst } } as unknown as Prisma.TransactionClient;
		const repository = new PrismaMcpTaskRepository(transaction);

		await expect(repository.load("silo-1", "mcp-task-1", _Submission().callDigest)).resolves.toMatchObject({ state: McpTaskStates.Completed, result: { temperature: 24 }, failureCode: null });
		await expect(repository.load("silo-1", "mcp-task-1", _Submission().callDigest)).resolves.toMatchObject({ state: McpTaskStates.Failed, result: null, failureCode: "mcp_tool_failed" });
	});
});
