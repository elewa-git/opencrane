import { z } from "zod";

import type { PersonalMemoryOperationTaskInput } from "./personal-memory-operation-task.types";

/** Rejects extra content or authority fields before identifiers enter the durable task input. */
export const _PersonalMemoryOperationTaskInputSchema: z.ZodType<PersonalMemoryOperationTaskInput> = z.object({
	siloId: z.string().min(1).max(128).refine(function _IsCanonical(value) { return value === value.trim(); }),
	operationId: z.string().uuid(),
}).strict();
