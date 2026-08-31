import { expect, it, vi } from "vitest";

import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";

import { PrismaAgentRunWorkflowTaskAdmissionUnitOfWork } from "../prisma-agent-run-workflow-task-admission-unit-of-work";

/** Proves the task repository and engine receive the transaction that owns the AgentRun attempt. */
it("admits and receipt-binds an AgentRun task through one transaction", async function _admitsTask()
{
	const transaction = {
		agentRun: { findUnique: vi.fn().mockResolvedValue({ siloId: "silo-1", attempt: 2 }) },
		agentRunWorkflowTask: {
			upsert: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 2, siloId: "silo-1", taskKey: "agent-run:silo-1:run-1:attempt:2", taskName: AgentRunTaskDeclaration.taskName }),
			updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			findUnique: vi.fn(),
		},
	};
	const workflow = {
		async spawn(workflowTransaction: unknown, task: { readonly taskName: string; readonly idempotencyKey: string })
		{
			expect(workflowTransaction).toEqual({ client: transaction });
			return { taskId: "task-1", taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		},
	};
	const admission = new PrismaAgentRunWorkflowTaskAdmissionUnitOfWork(transaction as never);

	await expect(admission.admit(workflow, { siloId: "silo-1", runId: "run-1", attempt: 2 })).resolves.toMatchObject({
		task: { runId: "run-1", attempt: 2 },
		receipt: { taskId: "task-1", taskName: AgentRunTaskDeclaration.taskName },
	});
	expect(transaction.agentRunWorkflowTask.updateMany).toHaveBeenCalledTimes(1);
});
