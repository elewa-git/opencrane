import { z, type ZodType } from "zod";

import type { RuntimeWorkloadBinding, RuntimeWorkloadClaim, RuntimeWorkloadClaimClass } from "./runtime-workload-claim.types";

/**
 * Checks the canonical UTC millisecond timestamp used to fence a controller delivery.
 *
 * Called by: the shared wire schemas below and any domain schema that fences on a timestamp.
 *
 * @param value - Candidate ISO timestamp from an untrusted request body.
 * @returns Whether the value round-trips exactly through `Date.toISOString()`.
 */
export function __IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** One canonical UTC millisecond timestamp field. */
function _CanonicalTimestamp()
{
	return z.string().datetime({ offset: true, precision: 3 }).refine(__IsCanonicalUtcMilliseconds);
}

/**
 * Defines the delivery fence and immutable Kubernetes identifiers a controller may return.
 *
 * Every claim-fenced workload family compares this exact six-field tuple, so the schema lives with
 * the {@link RuntimeWorkloadBinding} type it encodes instead of drifting per domain.
 *
 * Called by: the skill-authoring and artifact-preprocess controller wire contracts.
 */
export const __RuntimeWorkloadBindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: _CanonicalTimestamp(),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/**
 * Defines the exact durable task receipt one workload family accepts on its controller routes.
 *
 * The result is structurally identical to `IWorkflowTaskReceipt`; callers annotate it with that
 * type where they may import it.
 *
 * Called by: the skill-authoring and artifact-preprocess controller wire contracts.
 *
 * @param taskName - The single declared task name this family acts for.
 * @param idempotencyKeyPattern - Exact pattern of the family's task key.
 * @returns The strict receipt schema for that one family.
 */
export function __WorkflowTaskReceiptSchema(taskName: string, idempotencyKeyPattern: RegExp)
{
	return z.object({
		taskId: z.string().min(1).max(128),
		taskName: z.literal(taskName),
		idempotencyKey: z.string().regex(idempotencyKeyPattern),
	}).strict();
}

/**
 * Defines the complete server-issued claim one workload family accepts during final recovery.
 *
 * Called by: the skill-authoring controller wire contract; further families adopt it when they
 * accept a full claim on a route.
 *
 * @param options - The family's workload class, fixed profile name, and delivery ceiling.
 * @returns The strict claim schema for that one family.
 */
export function __RuntimeWorkloadClaimSchema(options: { readonly workloadClass: RuntimeWorkloadClaimClass; readonly profileName: string; readonly maximumDeliveries: number }): ZodType<RuntimeWorkloadClaim>
{
	return z.object({
		claimId: z.string().min(1).max(128),
		siloId: z.string().min(1).max(128),
		workloadClass: z.literal(options.workloadClass),
		profileName: z.literal(options.profileName),
		idempotencyKey: z.string().min(1).max(512),
		executionReference: z.string().min(1).max(512),
		claimedAt: _CanonicalTimestamp(),
		deliveryCount: z.number().int().min(1).max(options.maximumDeliveries),
		expiresAt: _CanonicalTimestamp(),
	}).strict() as ZodType<RuntimeWorkloadClaim>;
}

/**
 * Parses a strict JSON body without exposing validation-library details through a controller API.
 *
 * Called by: every controller wire contract that turns an untrusted body into a typed request.
 *
 * @param schema - Strict schema for the expected body.
 * @param value - Untrusted JSON value.
 * @returns The typed body, or `null` when the body does not match exactly.
 */
export function __ParseWorkloadWireBody<T>(schema: ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
