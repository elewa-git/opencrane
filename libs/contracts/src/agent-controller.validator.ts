import { z } from "zod";

import type { AgentControllerObotAttemptKey, AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunAttemptClaimLease, AgentControllerRunAttemptProjection, AgentControllerRunOutboxPruneResult, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim, AgentControllerRunWorkloadReleaseProjection } from "./agent-controller.types.js";
import { _AgentControllerBoundedIdentifierSchema, _AgentControllerMillisecondInstantSchema, _AgentControllerPositiveIntegerSchema, _ParseAgentControllerCommand, _ParseAgentControllerModel } from "./agent-controller-wire.validator.js";

/**
 * Runtime validators live beside the agent-controller wire models so their accepted payloads cannot
 * drift into transport-specific copies. HTTP adapters own byte and JSON boundaries only; this module
 * owns the model shapes and cross-field invariants shared by every controller transport.
 */

/** Maximum number of rows one outbox-prune response may report. */
const _MAXIMUM_PRUNED_ROWS = 1_000;

/** Return whether one value is the bounded non-negative count an outbox prune may report. */
function _IsPrunedCount(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= _MAXIMUM_PRUNED_ROWS;
}

/** Shared lease model plus its chronology invariant. */
const _RunAttemptClaimLeaseSchema: z.ZodType<AgentControllerRunAttemptClaimLease> = z.object({
	eventId: _AgentControllerBoundedIdentifierSchema,
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	expiresAt: _AgentControllerMillisecondInstantSchema,
}).strip().superRefine(function _ValidateChronology(lease, context)
{
	if (Date.parse(lease.claimedAt) >= Date.parse(lease.expiresAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "must expire after it is claimed" });
});

/** Optional attempt-scoped Obot material returned only on a claim response. */
const _AgentControllerObotAttemptKeySchema: z.ZodType<AgentControllerObotAttemptKey> = z.object({
	key: _AgentControllerBoundedIdentifierSchema,
	keyId: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Runtime-attempt projection model exposed to the Kubernetes controller. */
const _RunAttemptProjectionSchema: z.ZodType<AgentControllerRunAttemptProjection> = z.object({
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	agentServiceId: _AgentControllerBoundedIdentifierSchema,
	agentRevisionId: _AgentControllerBoundedIdentifierSchema,
	inputSnapshotDigest: _AgentControllerBoundedIdentifierSchema,
	namespace: _AgentControllerBoundedIdentifierSchema,
	workloadProfile: _AgentControllerBoundedIdentifierSchema,
	bootstrapReference: _AgentControllerBoundedIdentifierSchema,
	litellmKey: _AgentControllerBoundedIdentifierSchema,
	obotKey: _AgentControllerObotAttemptKeySchema.optional(),
}).strip();

/** Runtime-attempt claim model exposed to the Kubernetes controller. */
const _RunAttemptClaimSchema: z.ZodType<AgentControllerRunAttemptClaim> = z.object({ lease: _RunAttemptClaimLeaseSchema, attempt: _RunAttemptProjectionSchema }).strip();

/** Runtime assignment command accepted only with its exact declared evidence fields. */
const _RunAttemptAssignmentCommandSchema: z.ZodType<AgentControllerRunAttemptAssignmentCommand> = z.object({
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	expectedWorkloadProfile: _AgentControllerBoundedIdentifierSchema,
	bootstrapReference: _AgentControllerBoundedIdentifierSchema,
	namespace: _AgentControllerBoundedIdentifierSchema,
	serviceAccountName: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Runtime workload projection model exposed to the Kubernetes controller. */
const _RunWorkloadReleaseProjectionSchema: z.ZodType<AgentControllerRunWorkloadReleaseProjection> = z.object({
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	agentServiceId: _AgentControllerBoundedIdentifierSchema,
	agentRevisionId: _AgentControllerBoundedIdentifierSchema,
	namespace: _AgentControllerBoundedIdentifierSchema,
	serviceAccountName: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	workloadProfile: _AgentControllerBoundedIdentifierSchema,
	assignmentExpiresAt: _AgentControllerMillisecondInstantSchema,
	bootstrapReference: _AgentControllerBoundedIdentifierSchema,
	obotKeyProvisioned: z.boolean().optional(),
}).strip();

/** Runtime workload-release claim model exposed to the Kubernetes controller. */
const _RunWorkloadReleaseClaimSchema: z.ZodType<AgentControllerRunWorkloadReleaseClaim> = z.object({
	lease: _RunAttemptClaimLeaseSchema,
	workload: _RunWorkloadReleaseProjectionSchema,
}).strip();

/** Runtime first-Pod command accepted only with its exact declared evidence fields. */
const _RunWorkloadRegistrationCommandSchema: z.ZodType<AgentControllerRunWorkloadRegistrationCommand> = z.object({
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	agentServiceId: _AgentControllerBoundedIdentifierSchema,
	agentRevisionId: _AgentControllerBoundedIdentifierSchema,
	namespace: _AgentControllerBoundedIdentifierSchema,
	serviceAccountName: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	workloadProfile: _AgentControllerBoundedIdentifierSchema,
	bootstrapReference: _AgentControllerBoundedIdentifierSchema,
	podUid: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Runtime assignment response model before it is correlated with the submitted command. */
const _RunAttemptAssignmentResultSchema: z.ZodType<AgentControllerRunAttemptAssignmentResult> = z.object({
	outcome: z.enum(["assigned", "idempotent"]),
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/** Runtime first-Pod response model before it is correlated with the submitted command. */
const _RunWorkloadRegistrationResultSchema: z.ZodType<AgentControllerRunWorkloadRegistrationResult> = z.object({
	outcome: z.enum(["registered", "idempotent"]),
	runId: _AgentControllerBoundedIdentifierSchema,
	attempt: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	podUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/** Outbox-prune response model kept private because callers consume only the bounded count. */
const _OutboxPruneResultSchema: z.ZodType<AgentControllerRunOutboxPruneResult> = z.object({ deletedCount: z.custom<number>(_IsPrunedCount, { message: "must be an integer between 0 and 1000" }) }).strip();

/** Parse one exact runtime assignment command or return null for HTTP rejection. */
export function ___ParseAgentControllerRunAttemptAssignmentCommand(value: unknown): AgentControllerRunAttemptAssignmentCommand | null
{
	return _ParseAgentControllerCommand(_RunAttemptAssignmentCommandSchema, value);
}

/** Parse one exact runtime first-Pod command or return null for HTTP rejection. */
export function ___ParseAgentControllerRunWorkloadRegistrationCommand(value: unknown): AgentControllerRunWorkloadRegistrationCommand | null
{
	return _ParseAgentControllerCommand(_RunWorkloadRegistrationCommandSchema, value);
}

/** Parse one durable runtime-attempt claim without accepting untyped response fields. */
export function ___ParseAgentControllerRunAttemptClaim(value: unknown): AgentControllerRunAttemptClaim
{
	return _ParseAgentControllerModel(_RunAttemptClaimSchema, value, "controller claim");
}

/** Parse one exact workload-release claim before it reaches the Kubernetes adapter. */
export function ___ParseAgentControllerRunWorkloadReleaseClaim(value: unknown): AgentControllerRunWorkloadReleaseClaim
{
	return _ParseAgentControllerModel(_RunWorkloadReleaseClaimSchema, value, "workload-release claim");
}

/** Parse and correlate one assignment response with the exact submitted command. */
export function ___ParseAgentControllerRunAttemptAssignmentResult(value: unknown, command: AgentControllerRunAttemptAssignmentCommand): AgentControllerRunAttemptAssignmentResult
{
	const result = _ParseAgentControllerModel(_RunAttemptAssignmentResultSchema, value, "controller assignment result");
	if (result.runId !== command.runId || result.attempt !== command.attempt || result.workloadUid !== command.workloadUid) throw new Error("OpenCrane returned a mismatched controller assignment result");
	return result;
}

/** Parse and correlate one first-Pod response with the exact submitted command. */
export function ___ParseAgentControllerRunWorkloadRegistrationResult(value: unknown, command: AgentControllerRunWorkloadRegistrationCommand): AgentControllerRunWorkloadRegistrationResult
{
	const result = _ParseAgentControllerModel(_RunWorkloadRegistrationResultSchema, value, "first-Pod registration result");
	if (result.runId !== command.runId || result.attempt !== command.attempt || result.workloadUid !== command.workloadUid || result.podUid !== command.podUid) throw new Error("OpenCrane returned a mismatched first-Pod registration result");
	return result;
}

/** Parse the bounded count returned after maintenance removes delivered outbox records. */
export function ___ParseAgentControllerOutboxPrunedCount(value: unknown): number
{
	return _ParseAgentControllerModel(_OutboxPruneResultSchema, value, "outbox-prune result").deletedCount;
}
