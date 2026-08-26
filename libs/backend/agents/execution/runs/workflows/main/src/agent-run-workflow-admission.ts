import type { IWorkflowEngine, IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";

import { AgentRunWorkflowAdmissionError } from "./agent-run-workflow-admission.types";
import type { AgentRunWorkflowAdmission, AgentRunWorkflowAdmissionCommand, AgentRunWorkflowAdmissionTransaction, AgentRunWorkflowTaskRecord } from "./agent-run-workflow-admission.types";

/** Stops admission before the engine saves a task when the repository did not return one valid record. */
function _Record(command: AgentRunWorkflowAdmissionCommand, record: AgentRunWorkflowTaskRecord | undefined, rejectionReason: string | undefined): AgentRunWorkflowTaskRecord
{
	if (record === undefined || rejectionReason !== undefined)
	{
		throw new AgentRunWorkflowAdmissionError(`AgentRun workflow task was denied: ${rejectionReason ?? "invalid_repository_decision"}.`);
	}
	if (record.siloId !== command.siloId || record.runId !== command.runId || record.attempt !== command.attempt || record.attempt < 1 || record.taskKey.trim().length === 0)
	{
		throw new AgentRunWorkflowAdmissionError("AgentRun workflow repository returned conflicting immutable task facts.");
	}
	return record;
}

/** Stops admission when the engine receipt does not match the declared task or task key. */
function _Receipt(record: AgentRunWorkflowTaskRecord, receipt: IWorkflowTaskReceipt): IWorkflowTaskReceipt
{
	if (receipt.taskName !== AgentRunTaskDeclaration.taskName || receipt.idempotencyKey !== record.taskKey || receipt.taskId.trim().length === 0)
	{
		throw new AgentRunWorkflowAdmissionError("AgentRun workflow returned a conflicting task receipt.");
	}
	return receipt;
}

/**
 * Admits one AgentRun attempt task inside the caller's existing database transaction.
 *
 * The repository first proves the silo still owns the run and the attempt is current. The workflow
 * task is saved through that same transaction before its receipt is bound to the per-attempt record.
 * Any rejection throws so the caller can roll back both product changes and task admission.
 *
 * @param transaction - Caller-owned transaction with a repository scoped to that transaction.
 * @param workflow - Server-declared engine that saves the controller-hosted task.
 * @param command - Immutable silo, run, and attempt coordinates.
 * @returns The task record and receipt bound before the caller may commit.
 * @throws {AgentRunWorkflowAdmissionError} When immutable facts, receipt, or binding conflict.
 */
export async function __AdmitAgentRunWorkflowTask(transaction: AgentRunWorkflowAdmissionTransaction, workflow: IWorkflowEngine, command: AgentRunWorkflowAdmissionCommand): Promise<AgentRunWorkflowAdmission>
{
	const resolution = await transaction.tasks.createOrFind(command);
	const task = _Record(command, resolution.record, resolution.rejectionReason);
	const receipt = _Receipt(task, await workflow.spawn(transaction.workflowTransaction, {
		taskName: AgentRunTaskDeclaration.taskName,
		idempotencyKey: task.taskKey,
		input: { siloId: task.siloId, runId: task.runId, attempt: task.attempt },
	}));
	const binding = await transaction.tasks.bindTask(task, receipt);
	if (binding === "conflict")
	{
		throw new AgentRunWorkflowAdmissionError("AgentRun workflow task binding conflicts with saved facts.");
	}
	return { task, receipt };
}
