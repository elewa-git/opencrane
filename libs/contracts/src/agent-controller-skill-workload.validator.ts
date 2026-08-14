import { z } from "zod";

import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadAssignmentResult, AgentControllerSkillWorkloadClaim, AgentControllerSkillWorkloadPodRegistrationCommand, AgentControllerSkillWorkloadPodRegistrationResult, AgentControllerSkillWorkloadReleaseClaim, AgentControllerSkillWorkloadReleaseCommand, AgentControllerSkillWorkloadReleaseResult } from "./agent-controller-skill-workload.types";
import { _AgentControllerBoundedIdentifierSchema, _AgentControllerMillisecondInstantSchema, _AgentControllerPositiveIntegerSchema, _ParseAgentControllerCommand, _ParseAgentControllerModel } from "./agent-controller-wire.validator";

/**
 * Zod validators live beside the governed skill workload wire models so controller and server
 * transports cannot acquire separate field lists. Response schemas deliberately strip extensions,
 * while command schemas reject extensions before evidence reaches a persistence authority.
 */

/** Skill-workload claim fields, plus the rule that a claim must expire after it was claimed. */
const _SkillWorkloadClaimSchema: z.ZodType<AgentControllerSkillWorkloadClaim> = z.object({
	workloadId: _AgentControllerBoundedIdentifierSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	kind: z.enum(["authoring", "tool-runner"]),
	skillRevisionId: _AgentControllerBoundedIdentifierSchema,
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	expiresAt: _AgentControllerMillisecondInstantSchema,
}).strip().superRefine(function _ValidateChronology(claim, context)
{
	if (Date.parse(claim.claimedAt) >= Date.parse(claim.expiresAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "must expire after it is claimed" });
});

/** Skill assignment command accepted only with its exact declared evidence fields. */
const _SkillWorkloadAssignmentCommandSchema: z.ZodType<AgentControllerSkillWorkloadAssignmentCommand> = z.object({
	claimedAt: _AgentControllerMillisecondInstantSchema,
	deliveryCount: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	bootstrapReference: _AgentControllerBoundedIdentifierSchema,
	namespace: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Skill assignment response before it is correlated with the submitted workload evidence. */
const _SkillWorkloadAssignmentResultSchema: z.ZodType<AgentControllerSkillWorkloadAssignmentResult> = z.object({
	outcome: z.enum(["assigned", "idempotent"]),
	workloadId: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/** Skill workload release claim plus its claim chronology invariant. */
const _SkillWorkloadReleaseClaimSchema: z.ZodType<AgentControllerSkillWorkloadReleaseClaim> = z.object({
	workloadId: _AgentControllerBoundedIdentifierSchema,
	siloId: _AgentControllerBoundedIdentifierSchema,
	kind: z.enum(["authoring", "tool-runner"]),
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	releaseClaimedAt: _AgentControllerMillisecondInstantSchema,
	releaseDeliveryCount: _AgentControllerPositiveIntegerSchema,
	expiresAt: _AgentControllerMillisecondInstantSchema,
}).strip().superRefine(function _ValidateChronology(claim, context)
{
	if (Date.parse(claim.releaseClaimedAt) >= Date.parse(claim.expiresAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "must expire after it is claimed" });
});

/** Skill release command accepted only with its exact declared evidence fields. */
const _SkillWorkloadReleaseCommandSchema: z.ZodType<AgentControllerSkillWorkloadReleaseCommand> = z.object({
	releaseClaimedAt: _AgentControllerMillisecondInstantSchema,
	releaseDeliveryCount: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Skill first-Pod command accepted only with its exact declared evidence fields. */
const _SkillWorkloadPodRegistrationCommandSchema: z.ZodType<AgentControllerSkillWorkloadPodRegistrationCommand> = z.object({
	releaseClaimedAt: _AgentControllerMillisecondInstantSchema,
	releaseDeliveryCount: _AgentControllerPositiveIntegerSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	podUid: _AgentControllerBoundedIdentifierSchema,
}).strict();

/** Skill release response before it is correlated with the submitted workload evidence. */
const _SkillWorkloadReleaseResultSchema: z.ZodType<AgentControllerSkillWorkloadReleaseResult> = z.object({
	outcome: z.enum(["released", "idempotent"]),
	workloadId: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/** Skill first-Pod response before it is correlated with the submitted workload evidence. */
const _SkillWorkloadPodRegistrationResultSchema: z.ZodType<AgentControllerSkillWorkloadPodRegistrationResult> = z.object({
	outcome: z.enum(["registered", "idempotent"]),
	workloadId: _AgentControllerBoundedIdentifierSchema,
	workloadUid: _AgentControllerBoundedIdentifierSchema,
	podUid: _AgentControllerBoundedIdentifierSchema,
}).strip();

/** Parse one exact governed skill assignment command or return null for HTTP rejection. */
export function ___ParseAgentControllerSkillWorkloadAssignmentCommand(value: unknown): AgentControllerSkillWorkloadAssignmentCommand | null
{
	return _ParseAgentControllerCommand(_SkillWorkloadAssignmentCommandSchema, value);
}

/** Parse one exact governed skill release command or return null for HTTP rejection. */
export function ___ParseAgentControllerSkillWorkloadReleaseCommand(value: unknown): AgentControllerSkillWorkloadReleaseCommand | null
{
	return _ParseAgentControllerCommand(_SkillWorkloadReleaseCommandSchema, value);
}

/** Parse one exact governed skill first-Pod command or return null for HTTP rejection. */
export function ___ParseAgentControllerSkillWorkloadPodRegistrationCommand(value: unknown): AgentControllerSkillWorkloadPodRegistrationCommand | null
{
	return _ParseAgentControllerCommand(_SkillWorkloadPodRegistrationCommandSchema, value);
}

/** Parse one database-fenced governed skill workload claim. */
export function ___ParseAgentControllerSkillWorkloadClaim(value: unknown): AgentControllerSkillWorkloadClaim
{
	return _ParseAgentControllerModel(_SkillWorkloadClaimSchema, value, "skill workload claim");
}

/** Parse an assignment response and check it describes the same Job the controller submitted; a mismatch means the response cannot be trusted and is rejected. */
export function ___ParseAgentControllerSkillWorkloadAssignmentResult(value: unknown, workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand): AgentControllerSkillWorkloadAssignmentResult
{
	const result = _ParseAgentControllerModel(_SkillWorkloadAssignmentResultSchema, value, "skill workload assignment result");
	if (result.workloadId !== workloadId || result.workloadUid !== command.workloadUid) throw new Error("OpenCrane returned a mismatched skill workload assignment result");
	return result;
}

/** Parse one database-fenced governed skill workload release claim. */
export function ___ParseAgentControllerSkillWorkloadReleaseClaim(value: unknown): AgentControllerSkillWorkloadReleaseClaim
{
	return _ParseAgentControllerModel(_SkillWorkloadReleaseClaimSchema, value, "skill workload release claim");
}

/** Parse and correlate one governed skill release response with the submitted Job evidence. */
export function ___ParseAgentControllerSkillWorkloadReleaseResult(value: unknown, workloadId: string, command: AgentControllerSkillWorkloadReleaseCommand): AgentControllerSkillWorkloadReleaseResult
{
	const result = _ParseAgentControllerModel(_SkillWorkloadReleaseResultSchema, value, "skill workload release result");
	if (result.workloadId !== workloadId || result.workloadUid !== command.workloadUid) throw new Error("OpenCrane returned a mismatched skill workload release result");
	return result;
}

/** Parse and correlate one governed skill first-Pod response with the submitted evidence. */
export function ___ParseAgentControllerSkillWorkloadPodRegistrationResult(value: unknown, workloadId: string, command: AgentControllerSkillWorkloadPodRegistrationCommand): AgentControllerSkillWorkloadPodRegistrationResult
{
	const result = _ParseAgentControllerModel(_SkillWorkloadPodRegistrationResultSchema, value, "skill workload Pod-registration result");
	if (result.workloadId !== workloadId || result.workloadUid !== command.workloadUid || result.podUid !== command.podUid) throw new Error("OpenCrane returned a mismatched skill workload Pod-registration result");
	return result;
}
