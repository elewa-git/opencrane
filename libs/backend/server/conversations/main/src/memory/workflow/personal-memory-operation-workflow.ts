import type { IWorkflowEngine, IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";

import type { PersonalMemoryOperationAuthority } from "./personal-memory-operation-authority";
import { PERSONAL_MEMORY_OPERATION_TASK } from "./personal-memory-operation-task";
import type { PersonalMemoryOperationTaskInput, PersonalMemoryOperationTaskResult } from "./personal-memory-operation-task.types";

/** Registers the saved-phase owner without adding command admission or a public product route. */
export function _RegisterPersonalMemoryOperationWorkflow(workflows: IWorkflowEngine, authority: Pick<PersonalMemoryOperationAuthority, "run">): void
{
	workflows.register({ ...PERSONAL_MEMORY_OPERATION_TASK, run: function _run(context: IWorkflowTaskContext, input: PersonalMemoryOperationTaskInput): Promise<PersonalMemoryOperationTaskResult>
	{
		return authority.run(context, input);
	} });
}
