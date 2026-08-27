import { z, type ZodType } from "zod";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { AgentRunTaskNames } from "./agent-run-task.types";
import type { AgentRunWorkflowAssignmentRequest, AgentRunWorkflowAttemptKeyRevocationRequest, AgentRunWorkflowPodRequest, AgentRunWorkflowReleaseClaimRequest, AgentRunWorkflowTaskRequest } from "./agent-run-workflow-controller-http.types";
import type { AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation, AgentRunWorkflowReleaseClaim } from "./agent-run-workflow-controller.types";

/** Defines the exact durable receipt a controller may send back for an AgentRun task. */
const _TaskReceiptSchema: ZodType<IWorkflowTaskReceipt> = z.object({ taskId: z.string().min(1).max(128), taskName: z.literal(AgentRunTaskNames.Execute), idempotencyKey: z.string().min(1).max(512) }).strict();

/** Defines one raw transient key that must remain outside logs and durable state. */
const _AttemptKeySchema = z.object({ key: z.string().min(1).max(4096), keyAlias: z.string().min(1).max(128) }).strict();

/** Defines the narrow stable request identity the agent controller may send to the server. */
const _TaskRequestSchema: ZodType<AgentRunWorkflowTaskRequest> = z.object({
	input: z.object({ siloId: z.string().min(1).max(128), runId: z.string().min(1).max(128), attempt: z.number().int().positive() }).strict(),
	task: _TaskReceiptSchema,
}).strict();

/** Defines the only Job facts a controller can offer for a task-bound assignment. */
const _AssignmentRequestSchema: ZodType<AgentRunWorkflowAssignmentRequest> = _TaskRequestSchema.and(z.object({
	command: z.object({ workloadUid: z.string().min(1).max(256), workloadProfile: z.string().min(1).max(128), serviceAccountName: z.string().min(1).max(128) }).strict(),
}));

/** Defines the one immutable Pod identity a controller can bind to an assigned Job. */
const _PodRequestSchema: ZodType<AgentRunWorkflowPodRequest> = _TaskRequestSchema.and(z.object({
	command: z.object({ workloadUid: z.string().min(1).max(256), podUid: z.string().min(1).max(256) }).strict(),
}));

/** Defines the unpersisted raw model key returned only for an immediate controller revocation. */
const _AttemptKeyRevocationRequestSchema: ZodType<AgentRunWorkflowAttemptKeyRevocationRequest> = _TaskRequestSchema.and(z.object({
	attemptKey: _AttemptKeySchema,
}));

/** Defines the release claim request for one already-bound Job. */
const _ReleaseClaimRequestSchema: ZodType<AgentRunWorkflowReleaseClaimRequest> = _TaskRequestSchema.and(z.object({
	workloadUid: z.string().min(1).max(256),
}));

/** Defines the one bounded controller record the server may return to the controller. */
const _ControllerRecordSchema: ZodType<AgentRunWorkflowControllerRecord> = z.object({
	siloId: z.string().min(1).max(128),
	runId: z.string().min(1).max(128),
	attempt: z.number().int().positive(),
	agentServiceId: z.string().min(1).max(128),
	agentRevisionId: z.string().min(1).max(128),
	workloadProfile: z.string().min(1).max(128),
	namespace: z.string().min(1).max(128),
	bootstrapReference: z.string().min(1).max(512),
	assignmentExpiresAt: z.string().datetime({ offset: true, precision: 3 }),
}).strict();

/** Defines a short release claim that cannot lengthen the assignment lifetime. */
const _ReleaseClaimSchema: ZodType<AgentRunWorkflowReleaseClaim> = z.object({ expiresAt: z.string().datetime({ offset: true, precision: 3 }) }).strict();

/** Defines the state names the server exposes to an already-admitted workflow task. */
const _ObservationSchema: ZodType<AgentRunWorkflowObservation> = z.enum(["completed", "failed", "cancelled", "running", "stale"]);

/** Parses one incoming task request without exposing validation details to a controller. */
function _Parse<T>(schema: ZodType<T>, value: unknown): T | null
{
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** Parses the task identity used by load, mint, and observation requests. */
export function __ParseAgentRunWorkflowTaskRequest(value: unknown): AgentRunWorkflowTaskRequest | null
{
	return _Parse(_TaskRequestSchema, value);
}

/** Parses one Job-assignment report from the controller. */
export function __ParseAgentRunWorkflowAssignmentRequest(value: unknown): AgentRunWorkflowAssignmentRequest | null
{
	return _Parse(_AssignmentRequestSchema, value);
}

/** Parses one first-Pod report from the controller. */
export function __ParseAgentRunWorkflowPodRequest(value: unknown): AgentRunWorkflowPodRequest | null
{
	return _Parse(_PodRequestSchema, value);
}

/** Parses one raw key revocation request without persisting the raw key. */
export function __ParseAgentRunWorkflowAttemptKeyRevocationRequest(value: unknown): AgentRunWorkflowAttemptKeyRevocationRequest | null
{
	return _Parse(_AttemptKeyRevocationRequestSchema, value);
}

/** Parses one release claim request for an already-bound Job. */
export function __ParseAgentRunWorkflowReleaseClaimRequest(value: unknown): AgentRunWorkflowReleaseClaimRequest | null
{
	return _Parse(_ReleaseClaimRequestSchema, value);
}

/** Parses a bounded controller record returned through the internal HTTP adapter. */
export function __ParseAgentRunWorkflowControllerRecord(value: unknown): AgentRunWorkflowControllerRecord | null
{
	return _Parse(_ControllerRecordSchema, value);
}

/** Parses one fresh key response, which the caller must keep out of logs and durable state. */
export function __ParseAgentRunWorkflowAttemptKey(value: unknown): { readonly key: string; readonly keyAlias: string } | null
{
	return _Parse(_AttemptKeySchema, value);
}

/** Parses the two assignment-binding outcomes that remain non-terminal for an exact task. */
export function __ParseAgentRunWorkflowBindingOutcome(value: unknown): "bound" | "idempotent" | null
{
	return _Parse(z.object({ outcome: z.enum(["bound", "idempotent"]) }).strict(), value)?.outcome ?? null;
}

/** Parses a short release lease returned by the server. */
export function __ParseAgentRunWorkflowReleaseClaim(value: unknown): AgentRunWorkflowReleaseClaim | null
{
	return _Parse(_ReleaseClaimSchema, value);
}

/** Parses the task observation returned by the server. */
export function __ParseAgentRunWorkflowObservation(value: unknown): AgentRunWorkflowObservation | null
{
	return _Parse(_ObservationSchema, value);
}

/** Parses the durable task receipt that the controller sends back to the server. */
export function __ParseAgentRunWorkflowTaskReceipt(value: unknown): IWorkflowTaskReceipt | null
{
	return _Parse(_TaskReceiptSchema, value);
}
