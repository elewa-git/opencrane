import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { GROUP_CHILD_TASK } from "./group-child-task";
import type { GroupChildTaskInput } from "./group-child.types";
import type { PrismaGroupChildAuthority } from "./prisma-group-child-authority";

/** Registers recovery of an admitted child request with the workflow's persisted attempt number. */
export function _RegisterGroupChildWorkflow(workflows: IWorkflowEngine, authority: Pick<PrismaGroupChildAuthority, "run">): void
{
	workflows.register({ ...GROUP_CHILD_TASK, run: function _ResumeGroupChild(context, input: GroupChildTaskInput)
	{
		return authority.run(input, context.attempt);
	} });
}
