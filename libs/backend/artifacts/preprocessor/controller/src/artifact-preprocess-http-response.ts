import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { __ParseArtifactPreprocessOutcome } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { ArtifactPreprocessControllerRecord, ArtifactPreprocessOutcome } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { z, type ZodType } from "zod";

/** Check the canonical UTC timestamp carried by one database-issued workload claim. */
function _IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Validate the workload fence that a controller returns for server persistence. */
const _BindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/** Validate the complete server record before it can select a PDF preprocessing Job. */
const _RecordSchema: ZodType<ArtifactPreprocessControllerRecord> = z.object({
	preprocessJobId: z.string().min(1).max(128),
	siloId: z.string().min(1).max(128),
	claim: z.object({
		claimId: z.string().min(1).max(128),
		siloId: z.string().min(1).max(128),
		workloadClass: z.literal(RuntimeWorkloadClaimClasses.ArtifactPreprocess),
		profileName: z.string().min(1).max(63),
		idempotencyKey: z.string().min(1).max(512),
		claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
		deliveryCount: z.number().int().min(1),
		expiresAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
		executionReference: z.string().min(1).max(512),
	}).strict(),
}).strict();

/**
 * Validates a claim response and binds it to the preprocessing job in the request URL.
 *
 * Called by: `__CreateHttpArtifactPreprocessControllerAuthority`, before its handler can create a Job.
 */
export function _ParseArtifactPreprocessControllerRecord(value: unknown, preprocessJobId: string): ArtifactPreprocessControllerRecord
{
	const record = _RecordSchema.parse(value);
	if (record.preprocessJobId !== preprocessJobId)
	{
		throw new Error("OpenCrane artifact preprocessing response selected another job");
	}
	return record;
}

/**
 * Validates a binding response and binds it to the preprocessing job in the request URL.
 *
 * Called by: `__CreateHttpArtifactPreprocessControllerAuthority`, before it accepts a bound result.
 */
export function _ParseArtifactPreprocessBindOutcome(value: unknown, preprocessJobId: string): "bound" | "idempotent"
{
	const result = z.object({ outcome: z.enum(["bound", "idempotent"]), preprocessJobId: z.string().min(1).max(128) }).strict().parse(value);
	if (result.preprocessJobId !== preprocessJobId)
	{
		throw new Error("OpenCrane artifact preprocessing binding response did not match its request");
	}
	return result.outcome;
}

/**
 * Validates a persisted outcome against the job and delivery the controller requested.
 *
 * Called by: `__CreateHttpArtifactPreprocessControllerAuthority`. A mismatch throws before the
 * workflow handler can act on another controller delivery's outcome.
 *
 * @param value - Untrusted JSON response body.
 * @param preprocessJobId - Job identity in the authority request URL.
 * @param deliveryCount - Delivery selected by the controller's private event.
 * @returns Persisted outcome that matches both requested identities.
 * @throws Error when the response is malformed or selects another job or delivery.
 */
export function _ParseArtifactPreprocessOutcome(value: unknown, preprocessJobId: string, deliveryCount: number): ArtifactPreprocessOutcome
{
	const outcome = __ParseArtifactPreprocessOutcome(value);
	if (outcome.preprocessJobId !== preprocessJobId || outcome.deliveryCount !== deliveryCount)
	{
		throw new Error("OpenCrane artifact preprocessing outcome response selected another delivery");
	}
	return outcome;
}

/** Validates the fenced binding shape for controller HTTP boundaries. */
export function _ParseArtifactPreprocessBinding(value: unknown): RuntimeWorkloadBinding
{
	return _BindingSchema.parse(value);
}
