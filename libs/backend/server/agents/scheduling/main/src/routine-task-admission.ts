import type { IWorkflowEngine, IWorkflowTaskReceipt, IWorkflowTaskSpawn } from "@opencrane/backend/server/infra/workflows/contract";

import { ROUTINE_OCCURRENCE_TASK_NAME, ROUTINE_SCHEDULE_TASK_NAME } from "./routine-workflow-contract";
import { _ParseRoutineOccurrenceTaskInput, _ParseRoutineScheduleTaskInput } from "./routine-workflow-task.validator";
import type { RoutineOccurrenceTaskInput, RoutineScheduleTaskInput, RoutineTaskAdmissionPort } from "./routine-workflow.types";

/**
 * Admits routine tasks through the guarded workflow engine in the product's transaction.
 * Composition must declare both routine tasks and their queue policies before using this adapter.
 * It opens no transaction, selects no queue and grants no permission; engine failures propagate so
 * the caller can roll back the routine write together with task admission.
 */
export class RoutineTaskAdmission<Transaction> implements RoutineTaskAdmissionPort<Transaction>
{
	/** Receives the guarded engine without exposing registration or worker lifecycle to repositories. */
	public constructor(private readonly workflows: Pick<IWorkflowEngine, "spawn">) {}

	/** Recovers the same task for the same silo, routine revision and automatic slot. */
	public async admitSchedule(transaction: Transaction, input: RoutineScheduleTaskInput): Promise<IWorkflowTaskReceipt>
	{
		const savedInput = _ParseRoutineScheduleTaskInput(input);
		const task: IWorkflowTaskSpawn<RoutineScheduleTaskInput> = {
			taskName: ROUTINE_SCHEDULE_TASK_NAME,
			idempotencyKey: JSON.stringify([savedInput.siloId, savedInput.routineId, savedInput.routineRevision, savedInput.slotEpochMs]),
			input: savedInput,
		};
		return await this.workflows.spawn({ client: transaction }, task);
	}

	/** Recovers the same task for the saved occurrence; immutable firing identity owns retries. */
	public async admitOccurrence(transaction: Transaction, input: RoutineOccurrenceTaskInput): Promise<IWorkflowTaskReceipt>
	{
		const savedInput = _ParseRoutineOccurrenceTaskInput(input);
		const task: IWorkflowTaskSpawn<RoutineOccurrenceTaskInput> = {
			taskName: ROUTINE_OCCURRENCE_TASK_NAME,
			idempotencyKey: JSON.stringify([savedInput.siloId, savedInput.firingId]),
			input: savedInput,
		};
		return await this.workflows.spawn({ client: transaction }, task);
	}
}
