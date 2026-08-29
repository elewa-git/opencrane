import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadBinding, type RuntimeWorkloadClaim } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { z, type ZodType } from "zod";

import { SkillAuthoringValidationRecoveryReasons } from "./skill-authoring-validation-controller.types";
import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "./skill-authoring-validation-controller.types";
import type { SkillAuthoringValidationCompletionRequest, SkillAuthoringValidationPodBindRequest, SkillAuthoringValidationRecoveryRequest, SkillAuthoringValidationReleaseRequest, SkillAuthoringValidationUnboundExpiryRequest, SkillAuthoringValidationWorkloadBindRequest } from "./skill-authoring-validation-controller-http.types";
import { SkillAuthoringValidationTaskDeclaration, SkillAuthoringValidationTaskNames } from "./skill-authoring-validation-task.types";

/** Checks the canonical UTC timestamp used to fence a controller delivery. */
function _IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Defines the exact durable receipt that may act for an admitted validation. */
const _TaskReceiptSchema: ZodType<IWorkflowTaskReceipt> = z.object({
	taskId: z.string().min(1).max(128),
	taskName: z.literal(SkillAuthoringValidationTaskNames.Validate),
	idempotencyKey: z.string().regex(/^workflows:skill-authoring-validation:[a-f0-9]{64}$/u),
}).strict();

/** Defines the delivery fence and immutable Kubernetes identifiers a controller may return. */
const _BindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/** Defines the complete server-issued claim accepted by final unbound-expiry recovery. */
const _ClaimSchema: ZodType<RuntimeWorkloadClaim> = z.object({
	claimId: z.string().min(1).max(128),
	siloId: z.string().min(1).max(128),
	workloadClass: z.literal(RuntimeWorkloadClaimClasses.SkillAuthoringValidation),
	profileName: z.literal("authoring"),
	idempotencyKey: z.string().min(1).max(512),
	executionReference: z.string().min(1).max(512),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1).max(SkillAuthoringValidationTaskDeclaration.retryPolicy.maximumAttempts),
	expiresAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
}).strict();

/** Defines a strict workload bind body before its namespace is compared with deployment configuration. */
const _WorkloadBindBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema, bootstrapReference: z.string().min(1).max(512), namespace: z.string().min(1).max(63) }).strict();

/** Defines a strict first-Pod bind body. */
const _PodBindBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema }).strict();

/** Defines a strict terminal completion identity. */
const _CompletionBodySchema: ZodType<SkillAuthoringValidationCompletion> = z.object({ validationId: z.string().min(1).max(128), completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict();

/** Defines the task receipt and completion evidence that may reach the terminal writer. */
const _CompletionRequestBodySchema = z.object({ task: _TaskReceiptSchema, completion: _CompletionBodySchema }).strict();

/** Defines the exact task, binding, and stable Kubernetes recovery reason. */
const _RecoveryRequestBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema, reason: z.nativeEnum(SkillAuthoringValidationRecoveryReasons) }).strict();

/** Defines the saved task and final expired claim for a validation that never bound a Job. */
const _UnboundExpiryRequestBodySchema = z.object({ task: _TaskReceiptSchema, claim: _ClaimSchema }).strict();

/** Parses a strict JSON body without exposing validation-library details through the controller API. */
function _Parse<T>(schema: ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * Parses the task receipt that admission saved for this validation.
 *
 * Called by: `__CreateSkillAuthoringValidationControllerRouter` before it asks the authority for a
 * delivery.
 * @param value - Untrusted JSON request body.
 * @returns The saved-task receipt, or `null` when the body is not that receipt.
 */
export function __ParseSkillAuthoringValidationTaskReceipt(value: unknown): IWorkflowTaskReceipt | null
{
	return _Parse(_TaskReceiptSchema, value);
}

/**
 * Parses one Job bind request against the deployment-owned authoring namespace.
 *
 * Called by: `__CreateSkillAuthoringValidationControllerRouter` before it records a Job UID.
 * @param value - Untrusted JSON request body.
 * @param authoringNamespace - Namespace supplied by the server deployment.
 * @returns The task receipt and bind command, or `null` when the request widens the namespace.
 */
export function __ParseSkillAuthoringValidationWorkloadBindRequest(value: unknown, authoringNamespace: string): SkillAuthoringValidationWorkloadBindRequest | null
{
	const parsed = _Parse(_WorkloadBindBodySchema, value);
	if (parsed === null || parsed.binding.firstPodUid !== undefined || parsed.namespace !== authoringNamespace)
	{
		return null;
	}
	const command: SkillAuthoringValidationWorkloadBindCommand = { binding: parsed.binding, bootstrapReference: parsed.bootstrapReference, namespace: parsed.namespace };
	return { task: parsed.task, command };
}

/**
 * Parses one first-Pod bind request that carries the original Job delivery fence.
 *
 * Called by: `__CreateSkillAuthoringValidationControllerRouter` before it records the first Pod.
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and Pod command, or `null` when the binding has no first Pod UID.
 */
export function __ParseSkillAuthoringValidationPodBindRequest(value: unknown): SkillAuthoringValidationPodBindRequest | null
{
	const parsed = _Parse(_PodBindBodySchema, value);
	if (parsed === null || parsed.binding.firstPodUid === undefined)
	{
		return null;
	}
	const command: SkillAuthoringValidationPodBindCommand = { binding: parsed.binding };
	return { task: parsed.task, command };
}

/** Parses the exact bound Job whose release must still be valid by database time. */
export function __ParseSkillAuthoringValidationReleaseRequest(value: unknown): SkillAuthoringValidationReleaseRequest | null
{
	const parsed = _Parse(_PodBindBodySchema, value);
	return parsed === null || parsed.binding.firstPodUid !== undefined ? null : parsed;
}

/**
 * Parses a controller request to apply completion evidence loaded from this server.
 *
 * Called by: `__CreateSkillAuthoringValidationControllerRouter` before its terminal write.
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and completion identity, or `null` when either is invalid.
 */
export function __ParseSkillAuthoringValidationCompletionRequest(value: unknown): SkillAuthoringValidationCompletionRequest | null
{
	return _Parse(_CompletionRequestBodySchema, value);
}

/** Parse a task-owned Job recovery request without accepting worker-controlled evidence. */
export function __ParseSkillAuthoringValidationRecoveryRequest(value: unknown): SkillAuthoringValidationRecoveryRequest | null
{
	return _Parse(_RecoveryRequestBodySchema, value);
}

/** Parse the final unbound claim-expiry request without accepting a Kubernetes identity. */
export function __ParseSkillAuthoringValidationUnboundExpiryRequest(value: unknown): SkillAuthoringValidationUnboundExpiryRequest | null
{
	return _Parse(_UnboundExpiryRequestBodySchema, value);
}
