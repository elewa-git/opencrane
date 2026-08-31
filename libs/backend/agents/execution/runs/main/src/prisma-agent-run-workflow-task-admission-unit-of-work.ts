import { type Prisma } from "@prisma/client";

import { __AdmitAgentRunWorkflowTask } from "@opencrane/backend/agents/execution/runs/workflows";
import type { AgentRunWorkflowAdmission, AgentRunWorkflowAdmissionCommand } from "@opencrane/backend/agents/execution/runs/workflows";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { PrismaAgentRunWorkflowTaskRepository } from "./prisma-agent-run-workflow-task-repository";
import type { AgentRunWorkflowTaskAdmissionUnitOfWork as AgentRunWorkflowTaskAdmissionUnitOfWorkPort } from "./prisma-agent-run-workflow-task-admission.types";

/**
 * Joins AgentRun task admission to an already-open AgentRun database transaction.
 *
 * Called by: {@link PrismaRunAdmissionUnitOfWork} and {@link PrismaAgentRunAuthorityRepository}.
 * It creates the transaction-bound task repository in one place, so both first attempts and retries
 * pass the exact same database transaction to the task record and to Absurd.
 *
 * @implements AgentRunWorkflowTaskAdmissionUnitOfWorkPort
 */
export class PrismaAgentRunWorkflowTaskAdmissionUnitOfWork implements AgentRunWorkflowTaskAdmissionUnitOfWorkPort
{
	/** Transaction shared by the AgentRun attempt, its task record, and Absurd task admission. */
	private readonly _transaction: Prisma.TransactionClient;

	/** Binds task admission to the caller-owned AgentRun transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this._transaction = transaction;
	}

	/** Saves one controller task and its receipt within the transaction this unit of work received. */
	async admit(workflow: Pick<IWorkflowEngine, "spawn">, command: AgentRunWorkflowAdmissionCommand): Promise<AgentRunWorkflowAdmission>
	{
		const tasks = new PrismaAgentRunWorkflowTaskRepository(this._transaction);
		const workflowTransaction = { client: this._transaction };
		return __AdmitAgentRunWorkflowTask({ workflowTransaction, tasks }, workflow, command);
	}
}
