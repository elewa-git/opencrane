import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { __IsArtifactPreprocessBootstrapReference } from "@opencrane/contracts";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { z, type ZodType } from "zod";

import { ArtifactPreprocessRecoveryReasons } from "./artifact-preprocess-controller.types";
import type { ArtifactPreprocessPodBindCommand, ArtifactPreprocessRecoveryCommand, ArtifactPreprocessWorkloadBindCommand } from "./artifact-preprocess-controller.types";
import type { ArtifactPreprocessPodBindRequest, ArtifactPreprocessRecoveryRequest, ArtifactPreprocessWorkloadBindRequest } from "./artifact-preprocess-controller-http.types";
import { ArtifactPreprocessTaskNames } from "./artifact-preprocess-task.types";

/** Checks the UTC timestamp format that fences a controller delivery. */
function _IsCanonicalUtcMilliseconds(value: string): boolean
{
	const date = new Date(value);
	return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

/** Defines the saved task receipt that may act for a PDF conversion. */
const _TaskReceiptSchema: ZodType<IWorkflowTaskReceipt> = z.object({
	taskId: z.string().min(1).max(128),
	taskName: z.literal(ArtifactPreprocessTaskNames.Convert),
	idempotencyKey: z.string().regex(/^workflows:artifact-preprocess:[a-f0-9]{64}$/u),
}).strict();

/** Defines the delivery fence and Kubernetes identities a controller may return. */
const _BindingSchema: ZodType<RuntimeWorkloadBinding> = z.object({
	claimId: z.string().min(1).max(128),
	claimedAt: z.string().datetime({ offset: true, precision: 3 }).refine(_IsCanonicalUtcMilliseconds),
	deliveryCount: z.number().int().min(1),
	profileName: z.string().min(1).max(63),
	workloadUid: z.string().min(1).max(128),
	firstPodUid: z.string().min(1).max(128).optional(),
}).strict();

/** Defines a Job bind body before the server compares its namespace with deployment configuration. */
const _WorkloadBindBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema, bootstrapReference: z.string().min(1).max(512), namespace: z.string().min(1).max(63) }).strict();

/** Defines a first-Pod bind body. */
const _PodBindBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema }).strict();

/** Defines a recovery body with the complete saved binding and one controller-owned reason. */
const _RecoveryBodySchema = z.object({ task: _TaskReceiptSchema, binding: _BindingSchema, reason: z.enum([ArtifactPreprocessRecoveryReasons.JobTerminalWithoutOutcome, ArtifactPreprocessRecoveryReasons.JobMissingWithoutOutcome]) }).strict();

/** Parses strict JSON without exposing schema details through the private controller API. */
function _Parse<T>(schema: ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/**
 * Parses a Job bind request against the PDF worker namespace fixed by deployment.
 *
 * The controller router treats `null` as an invalid request and does not call its authority. This
 * keeps an untrusted controller body from changing the Job namespace or bootstrap reference.
 * Called by: `__CreateArtifactPreprocessControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @param workerNamespace - Namespace selected by the server deployment.
 * @returns The task receipt and Job bind command, or `null` when the request is invalid.
 */
export function __ParseArtifactPreprocessWorkloadBindRequest(value: unknown, workerNamespace: string): ArtifactPreprocessWorkloadBindRequest | null
{
	const parsed = _Parse(_WorkloadBindBodySchema, value);
	if (parsed === null || parsed.binding.firstPodUid !== undefined || parsed.namespace !== workerNamespace || !__IsArtifactPreprocessBootstrapReference(parsed.bootstrapReference))
	{
		return null;
	}
	const command: ArtifactPreprocessWorkloadBindCommand = { binding: parsed.binding, bootstrapReference: parsed.bootstrapReference, namespace: parsed.namespace };
	return { task: parsed.task, command };
}

/**
 * Parses a first-Pod bind request that carries the Job delivery fence.
 *
 * The controller router rejects `null` before it calls its authority, so a Pod without the saved
 * Job fence cannot be recorded as the worker. Called by: `__CreateArtifactPreprocessControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and Pod bind command, or `null` when the request is invalid.
 */
export function __ParseArtifactPreprocessPodBindRequest(value: unknown): ArtifactPreprocessPodBindRequest | null
{
	const parsed = _Parse(_PodBindBodySchema, value);
	if (parsed === null || parsed.binding.firstPodUid === undefined)
	{
		return null;
	}
	const command: ArtifactPreprocessPodBindCommand = { binding: parsed.binding };
	return { task: parsed.task, command };
}

/**
 * Parses a controller recovery request with the complete Job and first-Pod fence.
 *
 * Called by: `__CreateArtifactPreprocessControllerRouter` before it records an unreported Job
 * failure. A missing first-Pod UID is rejected because recovery begins only after Pod binding.
 *
 * @param value - Untrusted JSON request body.
 * @returns The task receipt and recovery command, or `null` when the body is incomplete.
 */
export function __ParseArtifactPreprocessRecoveryRequest(value: unknown): ArtifactPreprocessRecoveryRequest | null
{
	const parsed = _Parse(_RecoveryBodySchema, value);
	if (parsed === null || parsed.binding.firstPodUid === undefined)
	{
		return null;
	}
	const command: ArtifactPreprocessRecoveryCommand = { binding: parsed.binding, reason: parsed.reason };
	return { task: parsed.task, command };
}

/**
 * Parses the task receipt saved when PDF publication admitted this conversion.
 *
 * The controller router treats `null` as an invalid request and does not reveal preprocessing
 * state. Called by: `__CreateArtifactPreprocessControllerRouter`.
 *
 * @param value - Untrusted JSON request body.
 * @returns The saved PDF task receipt, or `null` when the receipt is invalid.
 */
export function __ParseArtifactPreprocessTaskReceipt(value: unknown): IWorkflowTaskReceipt | null
{
	return _Parse(_TaskReceiptSchema, value);
}
