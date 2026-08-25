import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { z, type ZodType } from "zod";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "./skill-authoring-validation-controller.types";
import type { SkillAuthoringValidationCompletionLoadRequest, SkillAuthoringValidationCompletionRequest, SkillAuthoringValidationPodBindRequest, SkillAuthoringValidationWorkloadBindRequest } from "./skill-authoring-validation-controller-http.types";
import { SkillAuthoringValidationTaskNames } from "./skill-authoring-validation-task.types";

/** Checks the one canonical UTC timestamp representation used to fence a controller delivery. */
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

/** Defines the lease fence and immutable Kubernetes identifiers a controller may return. */
const _BindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/** Defines a strict workload bind body before its namespace is compared to deployment configuration. */
const _WorkloadBindBodySchema = z.object({
	task: _TaskReceiptSchema,
	binding: _BindingSchema,
	bootstrapReference: z.string().min(1).max(512),
	namespace: z.string().min(1).max(63),
}).strict();

/** Defines a strict first-Pod bind body. */
const _PodBindBodySchema = z.object({
	task: _TaskReceiptSchema,
	binding: _BindingSchema,
}).strict();

/** Defines a strict completion inbox lookup body. */
const _CompletionLoadBodySchema = z.object({
	task: _TaskReceiptSchema,
	completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

/** Defines a strict completion terminal-write body. */
const _CompletionBodySchema: ZodType<SkillAuthoringValidationCompletion> = z.object({
	validationId: z.string().min(1).max(128),
	completionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
}).strict();

/** Defines the task receipt and completion evidence that may reach the terminal writer. */
const _CompletionRequestBodySchema = z.object({
	task: _TaskReceiptSchema,
	completion: _CompletionBodySchema,
}).strict();

/** Parses a strict JSON body without exposing Zod details through the internal controller API. */
function _Parse<T>(schema: ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * Parses the task receipt that an admitted validation saved for its controller delivery.
 *
 * The controller router treats `null` as an invalid request and does not call the authority, so a
 * receipt for another task cannot select validation work through this boundary. Called by:
 * `__CreateSkillAuthoringValidationControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The validation-task receipt, or `null` when the body is not that receipt.
 */
export function __ParseSkillAuthoringValidationTaskReceipt(value: unknown): IWorkflowTaskReceipt | null
{
	return _Parse(_TaskReceiptSchema, value);
}

/**
 * Parses one Job bind request against the authoring namespace fixed by deployment.
 *
 * A `null` result keeps the authority from recording a Job in a syntactically valid namespace that
 * the deployed authoring profile did not select. Called by:
 * `__CreateSkillAuthoringValidationControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @param authoringNamespace - Namespace supplied by the server's deployment configuration.
 * @returns The task receipt and bind command, or `null` when the request is malformed or changes the namespace.
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
 * Parses one first-Pod bind request that carries the Job delivery fence.
 *
 * The controller router rejects `null` before calling the authority, so a Pod without the Job's
 * fence cannot be recorded as its first Pod. Called by: `__CreateSkillAuthoringValidationControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and Pod-bind command, or `null` when the fence has no first Pod UID.
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

/**
 * Parses one request to load completion evidence from the server-owned inbox.
 *
 * The controller router treats `null` as invalid before it reads the authority, so callers must
 * provide the admitted task receipt and a SHA-256 completion digest. Called by:
 * `__CreateSkillAuthoringValidationControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and completion digest, or `null` when either is invalid.
 */
export function __ParseSkillAuthoringValidationCompletionLoadRequest(value: unknown): SkillAuthoringValidationCompletionLoadRequest | null
{
	return _Parse(_CompletionLoadBodySchema, value);
}

/**
 * Parses one request to apply completion evidence that the controller loaded from this server.
 *
 * The controller router rejects `null` before terminal state changes, leaving the authority to
 * match the completion identity to its saved inbox record. Called by:
 * `__CreateSkillAuthoringValidationControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and completion identity, or `null` when either is invalid.
 */
export function __ParseSkillAuthoringValidationCompletionRequest(value: unknown): SkillAuthoringValidationCompletionRequest | null
{
	return _Parse(_CompletionRequestBodySchema, value);
}
