import { z, type ZodType } from "zod";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { AgentRunTaskNames } from "./agent-run-task.types";
import type { AgentRunWorkflowTaskRequest } from "./agent-run-workflow-controller-http.types";
import type { AgentRunWarmRuntimeDeletionOutcome, AgentRunWarmRuntimeReplacementOutcome, AgentRunWarmRuntimeUnreservedCancellationOutcome, AgentRunWorkflowControllerRecord, AgentRunWorkflowObservation } from "./agent-run-workflow-controller.types";

/** Defines the exact durable receipt a controller may send back for an AgentRun task. */
const _TaskReceiptSchema: ZodType<IWorkflowTaskReceipt> = z.object({ taskId: z.string().min(1).max(128), taskName: z.literal(AgentRunTaskNames.Execute), idempotencyKey: z.string().min(1).max(512) }).strict();

/** Defines the narrow stable request identity the agent controller may send to the server. */
const _TaskRequestSchema: ZodType<AgentRunWorkflowTaskRequest> = z.object({
	input: z.object({ siloId: z.string().min(1).max(128), runId: z.string().min(1).max(128), attempt: z.number().int().positive() }).strict(),
	task: _TaskReceiptSchema,
}).strict();

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
	bindingGeneration: z.number().int().positive(),
	assignmentExpiresAt: z.string().datetime({ offset: true, precision: 3 }),
	observation: z.enum(["completed", "failed", "cancelling", "cancelled", "running", "waiting_for_input", "recovery_required", "stale"]),
}).strict();

/** Defines the state names the server exposes to an already-admitted workflow task. */
const _ObservationSchema: ZodType<AgentRunWorkflowObservation> = z.enum(["completed", "failed", "cancelling", "cancelled", "running", "waiting_for_input", "recovery_required", "stale"]);

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

/** Parses a bounded controller record returned through the internal HTTP adapter. */
export function __ParseAgentRunWorkflowControllerRecord(value: unknown): AgentRunWorkflowControllerRecord | null
{
	return _Parse(_ControllerRecordSchema, value);
}

/** Parses the two assignment-binding outcomes that remain non-terminal for an exact task. */
export function __ParseAgentRunWorkflowBindingOutcome(value: unknown): "bound" | "idempotent" | null
{
	return _Parse(z.object({ outcome: z.enum(["bound", "idempotent"]) }).strict(), value)?.outcome ?? null;
}

/** Parses a deletion result, including a safe wait for active provider output. */
export function __ParseAgentRunWorkflowDeletionOutcome(value: unknown): AgentRunWarmRuntimeDeletionOutcome | null
{
	return _Parse(z.object({ outcome: z.enum(["bound", "idempotent", "deferred", "conflict"]) }).strict(), value)?.outcome ?? null;
}

/** Parses the dead-runtime decision made after continuation validation and fencing. */
export function __ParseAgentRunWorkflowReplacementOutcome(value: unknown): AgentRunWarmRuntimeReplacementOutcome | null
{
	return _Parse(z.object({ outcome: z.enum(["replace", "recovery_required", "conflict"]) }).strict(), value)?.outcome ?? null;
}

/** Parses cancellation finalization when no warm Pod has been reserved. */
export function __ParseAgentRunWorkflowUnreservedCancellationOutcome(value: unknown): AgentRunWarmRuntimeUnreservedCancellationOutcome | null
{
	return _Parse(z.object({ outcome: z.enum(["bound", "idempotent", "deferred", "reservation_exists", "conflict"]) }).strict(), value)?.outcome ?? null;
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
