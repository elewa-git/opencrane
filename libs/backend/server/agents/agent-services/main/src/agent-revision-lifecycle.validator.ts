import { z } from "zod";

import { MANAGED_AGENT_RUNTIME_PROFILE_NAME } from "@opencrane/contracts";
import { AgentServiceStates, RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentRevisionContent } from "@opencrane/models/agents";

import { AgentServiceLifecycleActions, type ChangeAgentServiceStateCommand, type CreateManagedAgentServiceCommand, type ManagedRunNowCommand, type RestoreAgentRevisionCommand, type ReviseAgentRevisionCommand } from "./agent-revision-lifecycle.types";

/** Accepts one non-blank identifier or author-supplied description. */
const _NonBlankStringSchema = z.string().trim().min(1);
/** Accepts one positive safe integer used as a durable run limit. */
const _PositiveSafeIntegerSchema = z.number().int().safe().positive();
/** Accepts an ISO instant that JavaScript can parse without producing `NaN`. */
const _InstantSchema = z.string().refine(value => Number.isFinite(Date.parse(value)));
/** Rejects a list whose key repeats, before a persistence uniqueness constraint can fail. */
function _HasUniqueKeys<Item>(items: readonly Item[], key: (item: Item) => string): boolean
{
	return new Set(items.map(key)).size === items.length;
}

/** Validates all immutable content stored on a managed agent revision. */
const _AgentRevisionContentSchema: z.ZodType<AgentRevisionContent> = z.object({
	promptPolicyVersion: _NonBlankStringSchema,
	personaRevisionId: z.null(),
	modelDefinitionId: _NonBlankStringSchema,
	budget: z.object({
		maxTurns: _PositiveSafeIntegerSchema,
		maxTokens: _PositiveSafeIntegerSchema,
		maxDurationMs: _PositiveSafeIntegerSchema,
	}).strict(),
	skills: z.array(z.object({ skillId: _NonBlankStringSchema, revisionId: _NonBlankStringSchema }).strict()),
	mcpToolRevisionIds: z.array(_NonBlankStringSchema),
	boundaryAttachments: z.array(z.discriminatedUnion("boundaryKind", [
		z.object({ boundaryKind: z.literal(RevisionBoundaryKinds.Group), boundaryId: _NonBlankStringSchema, boundaryCoverage: z.enum([RevisionBoundaryCoverages.Exact, RevisionBoundaryCoverages.Descendants]) }).strict(),
		z.object({ boundaryKind: z.literal(RevisionBoundaryKinds.Personal), boundaryId: _NonBlankStringSchema, boundaryCoverage: z.literal(RevisionBoundaryCoverages.Exact) }).strict(),
	])),
}).strict().superRefine(function _CheckRevisionContent(content, context)
{
	if (!_HasUniqueKeys(content.skills, skill => skill.skillId))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "skill ids must be unique" });
	if (new Set(content.mcpToolRevisionIds).size !== content.mcpToolRevisionIds.length)
		context.addIssue({ code: z.ZodIssueCode.custom, message: "MCP tool revision ids must be unique" });
	if (!_HasUniqueKeys(content.boundaryAttachments, attachment => `${attachment.boundaryKind}\u0000${attachment.boundaryId}\u0000${attachment.boundaryCoverage}`))
		context.addIssue({ code: z.ZodIssueCode.custom, message: "boundary attachments must be unique" });
});

/** Validates a managed-service creation command, including its no-persona content rule. */
const _CreateManagedAgentServiceCommandSchema = z.object({
	principalId: _NonBlankStringSchema,
	siloId: _NonBlankStringSchema,
	name: _NonBlankStringSchema,
	workloadProfile: z.literal(MANAGED_AGENT_RUNTIME_PROFILE_NAME),
	authoredBy: _NonBlankStringSchema,
	changeMessage: _NonBlankStringSchema,
	content: _AgentRevisionContentSchema,
}).strict();

/** Validates an immutable revision append command. */
const _ReviseAgentRevisionCommandSchema = z.object({
	principalId: _NonBlankStringSchema,
	siloId: _NonBlankStringSchema,
	agentServiceId: _NonBlankStringSchema,
	expectedParentRevisionId: _NonBlankStringSchema.nullable(),
	authoredBy: _NonBlankStringSchema,
	changeMessage: _NonBlankStringSchema,
	content: _AgentRevisionContentSchema,
}).strict();

/** Validates a restore command that names an immutable source revision. */
const _RestoreAgentRevisionCommandSchema = z.object({
	principalId: _NonBlankStringSchema,
	siloId: _NonBlankStringSchema,
	agentServiceId: _NonBlankStringSchema,
	sourceRevisionId: _NonBlankStringSchema,
	expectedParentRevisionId: _NonBlankStringSchema.nullable(),
	authoredBy: _NonBlankStringSchema,
	changeMessage: _NonBlankStringSchema,
}).strict();

/** Validates a service-state command before transition policy evaluates it. */
const _ChangeAgentServiceStateCommandSchema = z.object({
	principalId: _NonBlankStringSchema,
	siloId: _NonBlankStringSchema,
	agentServiceId: _NonBlankStringSchema,
	expectedState: z.nativeEnum(AgentServiceStates),
	action: z.nativeEnum(AgentServiceLifecycleActions),
}).strict();

/** Fields shared by both managed run triggers. */
const _ManagedRunNowCommandFields = {
	agentServiceId: _NonBlankStringSchema,
	siloId: _NonBlankStringSchema,
	requestedBy: _NonBlankStringSchema,
	requestIdempotencyKey: _NonBlankStringSchema,
};

/** Validates the trigger-specific scheduled-slot invariant for managed run admission. */
const _ManagedRunNowCommandSchema = z.discriminatedUnion("trigger", [
	z.object({ ..._ManagedRunNowCommandFields, requestedByPrincipalId: _NonBlankStringSchema, trigger: z.literal("managed_invocation"), scheduledSlot: z.null() }).strict(),
	z.object({ ..._ManagedRunNowCommandFields, requestedByPrincipalId: z.null(), trigger: z.literal("schedule"), scheduledSlot: _InstantSchema }).strict(),
]);

/** Validates revision comparison coordinates without allowing blank silo or revision identifiers. */
const _CompareAgentRevisionsCoordinatesSchema = z.object({
	siloId: _NonBlankStringSchema,
	baseRevisionId: _NonBlankStringSchema,
	targetRevisionId: _NonBlankStringSchema,
}).strict();

/**
 * Checks a managed-service create command before the lifecycle writes its first revision.
 *
 * Managed services must not select a persona, and an invalid timestamp cannot be stored as immutable
 * history. A `false` result makes {@link __CreateManagedAgentService} return `invalid_command`
 * without calling its repository.
 * Called by: `__CreateManagedAgentService`.
 *
 * @param command - Requested service and initial revision content.
 * @param createdAt - Creation instant to persist with the initial revision.
 * @returns `true` when the command and instant can enter the lifecycle.
 */
export function _IsCreateManagedAgentServiceCommandValid(command: CreateManagedAgentServiceCommand, createdAt: string): boolean
{
	return _CreateManagedAgentServiceCommandSchema.safeParse(command).success && _InstantSchema.safeParse(createdAt).success;
}

/**
 * Checks a revision append command before the lifecycle asks the repository to create a draft.
 *
 * A `false` result prevents malformed immutable content or an invalid history instant from reaching
 * persistence; parent-revision concurrency remains the repository's responsibility.
 * Called by: `__ReviseAgentRevision`.
 *
 * @param command - Requested revision content and expected parent revision.
 * @param createdAt - Creation instant to persist with the draft revision.
 * @returns `true` when the command and instant have the required shape.
 */
export function _IsReviseAgentRevisionCommandValid(command: ReviseAgentRevisionCommand, createdAt: string): boolean
{
	return _ReviseAgentRevisionCommandSchema.safeParse(command).success && _InstantSchema.safeParse(createdAt).success;
}

/**
 * Checks a restore command before the lifecycle clones a source revision into a new draft.
 *
 * A `false` result keeps blank revision coordinates and invalid history instants from reaching the
 * repository; the repository still decides whether the named source and parent exist.
 * Called by: `__RestoreAgentRevision`.
 *
 * @param command - Source revision and expected parent for the new draft.
 * @param createdAt - Creation instant to persist with the restored revision.
 * @returns `true` when the command and instant have the required shape.
 */
export function _IsRestoreAgentRevisionCommandValid(command: RestoreAgentRevisionCommand, createdAt: string): boolean
{
	return _RestoreAgentRevisionCommandSchema.safeParse(command).success && _InstantSchema.safeParse(createdAt).success;
}

/**
 * Checks the fields needed to evaluate a managed-service state change.
 *
 * This does not decide whether the transition is legal: {@link __ChangeAgentServiceState} applies
 * the state-machine policy after this shape check. A `false` result returns `invalid_command`
 * before the repository is called.
 * Called by: `__ChangeAgentServiceState`.
 *
 * @param command - Observed state and requested lifecycle action.
 * @param changedAt - Change instant to persist if the transition succeeds.
 * @returns `true` when the command and instant have the required shape.
 */
export function _IsChangeAgentServiceStateCommandValid(command: ChangeAgentServiceStateCommand, changedAt: string): boolean
{
	return _ChangeAgentServiceStateCommandSchema.safeParse(command).success && _InstantSchema.safeParse(changedAt).success;
}

/**
 * Checks a managed run request before the lifecycle reads the target service.
 *
 * A scheduled run requires a scheduled slot, while a direct managed invocation must not carry one.
 * This keeps the two admission modes distinct before {@link __AdmitManagedRunNow} calls either
 * persistence boundary.
 * Called by: `__AdmitManagedRunNow`.
 *
 * @param command - Requested run target, requester, idempotency key, and trigger details.
 * @returns `true` when the trigger and scheduled-slot pair are valid.
 */
export function _IsManagedRunNowCommandValid(command: ManagedRunNowCommand): boolean
{
	return _ManagedRunNowCommandSchema.safeParse(command).success;
}

/**
 * Checks the coordinates for a revision comparison before either revision is read.
 *
 * A `false` result returns `invalid_command`; a valid shape does not grant access or prove both
 * revisions belong to one service, which {@link __CompareAgentRevisions} checks after its scoped
 * repository reads.
 * Called by: `__CompareAgentRevisions`.
 *
 * @param siloId - Silo in which both revisions must be resolved.
 * @param baseRevisionId - Earlier revision selected for the comparison.
 * @param targetRevisionId - Later revision selected for the comparison.
 * @returns `true` when the three coordinates are non-blank.
 */
export function _AreCompareAgentRevisionsCoordinatesValid(siloId: string, baseRevisionId: string, targetRevisionId: string): boolean
{
	return _CompareAgentRevisionsCoordinatesSchema.safeParse({ siloId, baseRevisionId, targetRevisionId }).success;
}
