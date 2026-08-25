import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerRecord } from "@opencrane/backend/agents/skills/workflows/contract";
import { z, type ZodType } from "zod";

/** Checks the canonical UTC timestamp carried by a database-issued workload lease. */
function _IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Validates the lease fence the server projected for the remote task handler. */
const _BindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/** Validates the complete record returned by the server before it can select Kubernetes work. */
const _RecordSchema: ZodType<SkillAuthoringValidationControllerRecord> = z.object({
	validationId: z.string().min(1).max(128),
	siloId: z.string().min(1).max(128),
	jobId: z.string().min(1).max(128),
	claim: z.object({
		claimId: z.string().min(1).max(128),
		siloId: z.string().min(1).max(128),
		workloadClass: z.literal(RuntimeWorkloadClaimClasses.SkillAuthoringValidation),
		profileName: z.string().min(1).max(63),
		idempotencyKey: z.string().min(1).max(512),
		claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
		deliveryCount: z.number().int().min(1),
		expiresAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
		executionReference: z.string().min(1).max(512),
	}).strict(),
}).strict();

/** Validates completion evidence that belongs to the requested validation. */
const _CompletionSchema: ZodType<SkillAuthoringValidationCompletion> = z.object({
	validationId: z.string().min(1).max(128),
	completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

/** Validates one claim record belongs to the validation selected by its request. */
export function _ParseSkillAuthoringValidationControllerRecord(value: unknown, validationId: string): SkillAuthoringValidationControllerRecord
{
	const record = _RecordSchema.parse(value);
	if (record.validationId !== validationId)
	{
		throw new Error("OpenCrane skill authoring validation response selected another validation");
	}
	return record;
}

/** Validates one completion record belongs to the validation selected by its request. */
export function _ParseSkillAuthoringValidationCompletion(value: unknown, validationId: string): SkillAuthoringValidationCompletion
{
	const completion = _CompletionSchema.parse(value);
	if (completion.validationId !== validationId)
	{
		throw new Error("OpenCrane skill authoring validation completion selected another validation");
	}
	return completion;
}

/** Validates a successful controller response belongs to this request and names an accepted outcome. */
function _Outcome(value: unknown, validationId: string, accepted: readonly ("bound" | "completed" | "idempotent")[]): "bound" | "completed" | "idempotent"
{
	const result = z.object({ outcome: z.enum(["bound", "completed", "idempotent"]), validationId: z.string().min(1).max(128) }).strict().parse(value);
	if (result.validationId !== validationId || !accepted.includes(result.outcome))
	{
		throw new Error("OpenCrane skill authoring validation response did not match its request");
	}
	return result.outcome;
}

/** Narrows an accepted bind result to the two states the handler can continue from. */
export function _ParseSkillAuthoringValidationBindOutcome(value: unknown, validationId: string): "bound" | "idempotent"
{
	const outcome = _Outcome(value, validationId, ["bound", "idempotent"]);
	if (outcome !== "bound" && outcome !== "idempotent")
	{
		throw new Error("OpenCrane skill authoring validation binding response had an invalid outcome");
	}
	return outcome;
}

/** Narrows an accepted terminal result to the two states the handler can return. */
export function _ParseSkillAuthoringValidationCompletionOutcome(value: unknown, validationId: string): "completed" | "idempotent"
{
	const outcome = _Outcome(value, validationId, ["completed", "idempotent"]);
	if (outcome !== "completed" && outcome !== "idempotent")
	{
		throw new Error("OpenCrane skill authoring validation completion response had an invalid outcome");
	}
	return outcome;
}
