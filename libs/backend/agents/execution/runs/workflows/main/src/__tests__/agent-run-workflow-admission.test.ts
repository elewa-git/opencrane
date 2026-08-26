import { describe, expect, it, vi } from "vitest";

import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";

import { __AdmitAgentRunWorkflowTask, AgentRunWorkflowAdmissionError, AgentRunWorkflowAdmissionRejectionReasons } from "../index";
import type { AgentRunWorkflowAdmissionCommand, AgentRunWorkflowAdmissionTransaction, AgentRunWorkflowTaskRecord, AgentRunWorkflowTaskRepository } from "../index";

/** Returns fixed immutable coordinates for one AgentRun attempt task. */
function _Command(): AgentRunWorkflowAdmissionCommand
{
	return { siloId: "silo-1", runId: "run-1", attempt: 1 };
}

/** Returns the transaction-scoped task record that may be admitted for the fixed command. */
function _Record(): AgentRunWorkflowTaskRecord
{
	return { ..._Command(), taskKey: "run-1:attempt:1" };
}

/** Builds transaction and workflow fakes while preserving their required operation order. */
function _Context()
{
	const calls: string[] = [];
	const task = _Record();
	const workflowTransaction = { client: { transaction: "caller-owned" } };
	const createOrFind = vi.fn<AgentRunWorkflowTaskRepository["createOrFind"]>(async function _CreateOrFind() { calls.push("create-or-find"); return { record: task }; });
	const bindTask = vi.fn<AgentRunWorkflowTaskRepository["bindTask"]>(async function _BindTask() { calls.push("bind-task"); return "bound"; });
	const transaction = { workflowTransaction, tasks: { createOrFind, bindTask } } satisfies AgentRunWorkflowAdmissionTransaction;
	const workflow = {
		spawn: vi.fn(async function _Spawn(receivedTransaction) { calls.push("spawn"); expect(receivedTransaction).toBe(workflowTransaction); return { taskId: "task-1", taskName: AgentRunTaskDeclaration.taskName, idempotencyKey: task.taskKey }; }),
	};
	return { bindTask, calls, createOrFind, task, transaction, workflow };
}

describe("AgentRun workflow task admission", function _DescribeAgentRunWorkflowTaskAdmission()
{
	it("creates or finds immutable task facts, saves the remote task, then binds its receipt", async function _AdmitsTask()
	{
		const { calls, task, transaction, workflow } = _Context();

		await expect(__AdmitAgentRunWorkflowTask(transaction, workflow as never, _Command())).resolves.toEqual({ task, receipt: { taskId: "task-1", taskName: AgentRunTaskDeclaration.taskName, idempotencyKey: task.taskKey } });
		expect(calls).toEqual(["create-or-find", "spawn", "bind-task"]);
		expect(workflow.spawn).toHaveBeenCalledWith(transaction.workflowTransaction, { taskName: AgentRunTaskDeclaration.taskName, idempotencyKey: task.taskKey, input: _Command() });
	});

	it.each(Object.values(AgentRunWorkflowAdmissionRejectionReasons))("stops before task admission when the repository returns %s", async function _RejectsRepositoryReason(rejectionReason)
	{
		const { bindTask, createOrFind, transaction, workflow } = _Context();
		createOrFind.mockResolvedValue({ rejectionReason });

		await expect(__AdmitAgentRunWorkflowTask(transaction, workflow as never, _Command())).rejects.toEqual(new AgentRunWorkflowAdmissionError(`AgentRun workflow task was denied: ${rejectionReason}.`));
		expect(workflow.spawn).not.toHaveBeenCalled();
		expect(bindTask).not.toHaveBeenCalled();
	});

	it("stops before task admission when a faulty repository returns both a record and a refusal", async function _RejectsMalformedRepositoryResolution()
	{
		const { bindTask, createOrFind, task, transaction, workflow } = _Context();
		createOrFind.mockResolvedValue({ record: task, rejectionReason: AgentRunWorkflowAdmissionRejectionReasons.ForeignSilo });

		await expect(__AdmitAgentRunWorkflowTask(transaction, workflow as never, _Command())).rejects.toEqual(new AgentRunWorkflowAdmissionError("AgentRun workflow task was denied: foreign_silo."));
		expect(workflow.spawn).not.toHaveBeenCalled();
		expect(bindTask).not.toHaveBeenCalled();
	});

	it("propagates a task-admission failure so the caller can roll back", async function _PropagatesSpawnFailure()
	{
		const { bindTask, transaction, workflow } = _Context();
		workflow.spawn.mockRejectedValue(new Error("workflow persistence unavailable"));

		await expect(__AdmitAgentRunWorkflowTask(transaction, workflow as never, _Command())).rejects.toThrow("workflow persistence unavailable");
		expect(bindTask).not.toHaveBeenCalled();
	});

	it("rejects a conflicting saved task binding after task admission", async function _RejectsBindingConflict()
	{
		const { bindTask, transaction, workflow } = _Context();
		bindTask.mockResolvedValue("conflict");

		await expect(__AdmitAgentRunWorkflowTask(transaction, workflow as never, _Command())).rejects.toThrow("task binding conflicts");
	});
});
