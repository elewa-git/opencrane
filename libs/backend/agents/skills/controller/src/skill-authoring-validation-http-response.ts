import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { SkillAuthoringValidationBindOutcome, SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationCurrentStatus, SkillAuthoringValidationRecoveryOutcome, SkillAuthoringValidationReleaseOutcome } from "@opencrane/backend/agents/skills/workflows/contract";
import { z, type ZodType } from "zod";

/** Checks the canonical UTC timestamp carried by a database-issued workload lease. */
function _IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Validates the complete record returned before it can select Kubernetes work. */
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

/** Validates completion evidence returned from the server-owned inbox. */
const _CompletionSchema: ZodType<SkillAuthoringValidationCompletion> = z.object({ validationId: z.string().min(1).max(128), completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict();

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

/** Validates a read-only lifecycle result belongs to the selected validation. */
export function _ParseSkillAuthoringValidationCurrentStatus(value: unknown, validationId: string): SkillAuthoringValidationCurrentStatus
{
	const result = z.object({ status: z.enum(["active", "completed", "cancelled", "conflict"]), validationId: z.string().min(1).max(128) }).strict().parse(value);
	if (result.validationId !== validationId)
	{
		throw new Error("OpenCrane skill authoring validation status selected another validation");
	}
	return result.status;
}

/** Validates a successful response belongs to this request and names an accepted outcome. */
function _Outcome(value: unknown, validationId: string, accepted: readonly ("bound" | "completed" | "expired" | "idempotent")[]): "bound" | "completed" | "expired" | "idempotent"
{
	const result = z.object({ outcome: z.enum(["bound", "completed", "expired", "idempotent"]), validationId: z.string().min(1).max(128) }).strict().parse(value);
	if (result.validationId !== validationId || !accepted.includes(result.outcome))
	{
		throw new Error("OpenCrane skill authoring validation response did not match its request");
	}
	return result.outcome;
}

/** Narrows an accepted bind result to the states from which the handler may continue. */
export function _ParseSkillAuthoringValidationBindOutcome(value: unknown, validationId: string): Exclude<SkillAuthoringValidationBindOutcome, "conflict">
{
	const outcome = _Outcome(value, validationId, ["bound", "expired", "idempotent"]);
	if (outcome !== "bound" && outcome !== "expired" && outcome !== "idempotent")
	{
		throw new Error("OpenCrane skill authoring validation binding response had an invalid outcome");
	}
	return outcome;
}

/** Narrows an accepted terminal result to the states the handler may return. */
export function _ParseSkillAuthoringValidationCompletionOutcome(value: unknown, validationId: string): "completed" | "idempotent"
{
	const outcome = _Outcome(value, validationId, ["completed", "idempotent"]);
	if (outcome !== "completed" && outcome !== "idempotent")
	{
		throw new Error("OpenCrane skill authoring validation completion response had an invalid outcome");
	}
	return outcome;
}

/** Narrows a task-owned recovery response to one saved failure outcome. */
export function _ParseSkillAuthoringValidationRecoveryOutcome(value: unknown, validationId: string): Exclude<SkillAuthoringValidationRecoveryOutcome, "conflict">
{
	const result = z.object({ outcome: z.enum(["failed", "idempotent", "not_expired"]), validationId: z.string().min(1).max(128) }).strict().parse(value);
	if (result.validationId !== validationId)
	{
		throw new Error("OpenCrane skill authoring validation recovery selected another validation");
	}
	return result.outcome;
}

/** Validates the database-time decision returned immediately before Job release. */
export function _ParseSkillAuthoringValidationReleaseOutcome(value: unknown, validationId: string): Exclude<SkillAuthoringValidationReleaseOutcome, "conflict">
{
	const result = z.discriminatedUnion("outcome", [
		z.object({ outcome: z.literal("authorized"), releaseLifetimeSeconds: z.number().int().min(1).max(300), validationId: z.string().min(1).max(128) }).strict(),
		z.object({ outcome: z.literal("expired"), validationId: z.string().min(1).max(128) }).strict(),
	]).parse(value);
	if (result.validationId !== validationId)
	{
		throw new Error("OpenCrane skill authoring validation release decision selected another validation");
	}
	return "releaseLifetimeSeconds" in result ? { outcome: "authorized", releaseLifetimeSeconds: result.releaseLifetimeSeconds } : result.outcome;
}
