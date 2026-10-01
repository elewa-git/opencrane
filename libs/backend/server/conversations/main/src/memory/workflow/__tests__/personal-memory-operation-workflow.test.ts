import type { IWorkflowEngine, IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";
import { describe, expect, it, vi } from "vitest";

import type { PersonalMemoryOperationAuthority } from "../personal-memory-operation-authority";
import { PERSONAL_MEMORY_OPERATION_TASK } from "../personal-memory-operation-task";
import { PersonalMemoryOperationTaskOutcomes, type PersonalMemoryOperationTaskInput, type PersonalMemoryOperationTaskResult } from "../personal-memory-operation-task.types";
import { _RegisterPersonalMemoryOperationWorkflow } from "../personal-memory-operation-workflow";

describe("personal memory operation workflow registration", function _Suite()
{
	it("registers the existing declaration and delegates the exact context and identifier-only input", async function _Registers()
	{
		let definition: IWorkflowTaskDefinition<PersonalMemoryOperationTaskInput, PersonalMemoryOperationTaskResult> | undefined;
		const workflows = { register: vi.fn(function _Register(value) { definition = value; }) } as unknown as IWorkflowEngine;
		const result = { outcome: PersonalMemoryOperationTaskOutcomes.Completed, operationId: "928b379d-d679-42db-bd46-c938bb15f3d1" } as const;
		const authority = { run: vi.fn().mockResolvedValue(result) } as unknown as Pick<PersonalMemoryOperationAuthority, "run">;
		_RegisterPersonalMemoryOperationWorkflow(workflows, authority);
		expect(workflows.register).toHaveBeenCalledOnce();
		expect(definition).toMatchObject({ taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, retryPolicy: PERSONAL_MEMORY_OPERATION_TASK.retryPolicy });
		const context = { task: { taskId: "task-1", taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, idempotencyKey: result.operationId } } as IWorkflowTaskContext;
		const input = { siloId: "silo-1", operationId: result.operationId };
		await expect(definition!.run(context, input)).resolves.toEqual(result);
		expect(authority.run).toHaveBeenCalledWith(context, input);
	});
});
