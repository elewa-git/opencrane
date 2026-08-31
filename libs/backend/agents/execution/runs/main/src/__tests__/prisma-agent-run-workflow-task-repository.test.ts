import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { AgentRunWorkflowAdmissionRejectionReasons } from "@opencrane/backend/agents/execution/runs/workflows";

import { PrismaAgentRunWorkflowTaskRepository } from "../prisma-agent-run-workflow-task-repository";

/** Returns the immutable coordinates of one current AgentRun attempt. */
function _command()
{
	return { siloId: "silo-1", runId: "run-1", attempt: 2 } as const;
}

/** Returns the stored controller task facts for the standard test attempt. */
function _taskRow(overrides: Partial<{ readonly siloId: string; readonly taskKey: string; readonly taskName: string; readonly taskId: string | null }> = {})
{
	return {
		runId: "run-1",
		attempt: 2,
		siloId: "silo-1",
		taskKey: "agent-run:silo-1:run-1:attempt:2",
		taskName: AgentRunTaskDeclaration.taskName,
		taskId: null,
		...overrides,
	};
}

/** Returns a task receipt that exactly belongs to the standard test attempt. */
function _receipt(overrides: Partial<{ readonly taskId: string; readonly taskName: string; readonly idempotencyKey: string }> = {})
{
	return {
		taskId: "task-1",
		taskName: AgentRunTaskDeclaration.taskName,
		idempotencyKey: "agent-run:silo-1:run-1:attempt:2",
		...overrides,
	};
}

/** Builds one transaction double with only the delegates this repository owns. */
function _transaction(overrides: Partial<{ readonly run: object | null; readonly task: object | null; readonly updatedCount: number }> = {})
{
	const run = overrides.run === undefined ? { siloId: "silo-1", attempt: 2 } : overrides.run;
	const task = overrides.task === undefined ? _taskRow() : overrides.task;
	const updatedCount = overrides.updatedCount ?? 1;
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue(run) },
		agentRunWorkflowTask: {
			upsert: vi.fn().mockResolvedValue(task),
			updateMany: vi.fn().mockResolvedValue({ count: updatedCount }),
			findUnique: vi.fn().mockResolvedValue(task),
		},
	};
}

describe("PrismaAgentRunWorkflowTaskRepository", function _describeWorkflowTaskRepository()
{
	it("rejects a missing or foreign run before creating a task", async function _rejectsForeignRun()
	{
		const transaction = _transaction({ run: null });
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);

		await expect(repository.createOrFind(_command())).resolves.toEqual({ rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.ForeignSilo });
		expect(transaction.agentRunWorkflowTask.upsert).not.toHaveBeenCalled();
	});

	it("rejects an old attempt before creating a task", async function _rejectsStaleAttempt()
	{
		const transaction = _transaction({ run: { siloId: "silo-1", attempt: 3 } });
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);

		await expect(repository.createOrFind(_command())).resolves.toEqual({ rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.StaleAttempt });
		expect(transaction.agentRunWorkflowTask.upsert).not.toHaveBeenCalled();
	});

	it("creates a task only with the declared name and stable key", async function _createsTask()
	{
		const transaction = _transaction();
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);

		await expect(repository.createOrFind(_command())).resolves.toEqual({ record: { runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2" } });
		expect(transaction.agentRunWorkflowTask.upsert).toHaveBeenCalledWith({
			where: { runId_attempt: { runId: "run-1", attempt: 2 } },
			create: { runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2", taskName: AgentRunTaskDeclaration.taskName },
			update: {},
			select: { runId: true, attempt: true, siloId: true, taskKey: true, taskName: true },
		});
	});

	it("rejects an existing task that has different immutable facts", async function _rejectsConflictingTask()
	{
		const transaction = _transaction({ task: _taskRow({ taskName: "other-task/v1" }) });
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);

		await expect(repository.createOrFind(_command())).resolves.toEqual({ rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.ConflictingTask });
	});

	it("binds the first exact engine receipt", async function _bindsReceipt()
	{
		const transaction = _transaction();
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);
		const record = { runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2" };

		await expect(repository.bindTask(record, _receipt())).resolves.toBe("bound");
		expect(transaction.agentRunWorkflowTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2", taskName: AgentRunTaskDeclaration.taskName, taskId: null }),
			data: expect.objectContaining({ taskId: "task-1" }),
		}));
	});

	it("accepts a replay only when the saved receipt is exact", async function _acceptsExactReceiptReplay()
	{
		const transaction = _transaction({ updatedCount: 0, task: _taskRow({ taskId: "task-1" }) });
		const repository = new PrismaAgentRunWorkflowTaskRepository(transaction as never);
		const record = { runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2" };

		await expect(repository.bindTask(record, _receipt())).resolves.toBe("idempotent");
		await expect(repository.bindTask(record, _receipt({ taskId: "task-2" }))).resolves.toBe("conflict");
	});
});
