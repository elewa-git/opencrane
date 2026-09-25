import { z, type ZodType } from "zod";

import { SkillAuthoringValidationWorkerOutcomes } from "./skill-authoring-validation-worker.types";
import type { SkillAuthoringValidationCheckReport, SkillAuthoringValidationWorkerCompletion } from "./skill-authoring-validation-worker.types";

/** Rejects control characters in durable worker-owned labels and summaries. */
const _NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]+$/u;

/** Validates one passing test or scan report without accepting command output or nested data. */
const _ReportSchema: ZodType<SkillAuthoringValidationCheckReport> = z.object({
	passed: z.literal(true),
	summary: z.string().min(1).max(2_000).regex(_NO_CONTROL_CHARACTERS),
	checksRun: z.number().int().min(0).max(10_000),
}).strict();

/** Validates the complete bounded terminal command before it reaches persistence. */
const _CompletionSchema: ZodType<SkillAuthoringValidationWorkerCompletion> = z.discriminatedUnion("outcome", [
	z.object({ validationId: z.string().min(1).max(256).regex(_NO_CONTROL_CHARACTERS), outcome: z.literal(SkillAuthoringValidationWorkerOutcomes.Succeeded), testReport: _ReportSchema, scanResult: _ReportSchema }).strict(),
	z.object({ validationId: z.string().min(1).max(256).regex(_NO_CONTROL_CHARACTERS), outcome: z.literal(SkillAuthoringValidationWorkerOutcomes.Failed), failureCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u) }).strict(),
]);

/** Parses one terminal worker command and returns null for every unsupported shape. */
export function _ParseSkillAuthoringValidationWorkerCompletion(value: unknown): SkillAuthoringValidationWorkerCompletion | null
{
	const parsed = _CompletionSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
