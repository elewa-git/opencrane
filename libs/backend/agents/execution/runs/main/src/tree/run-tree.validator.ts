import { z } from "zod";

import { RunTreeClosureReasons, type RunTreeChildCommand, type RunTreeCloseCommand, type RunTreeReservationCommand, type RunTreeResources, type RunTreeRootCommand } from "./run-tree.types";

/**
 * Validates backend commands before the runs repository reads or writes accounting rows.
 * These schemas stay beside their models so resource fields cannot drift. Shape validation grants
 * no authority: the transaction must separately verify current permissions, snapshots and lineage.
 */

/** Rejects blank identifiers without changing the value bound by admission and reservation digests. */
const _IDENTIFIER_SCHEMA = z.string().regex(/\S/u);

/** Matches PostgreSQL Int storage; this is not a limit on children, nesting or parallel execution. */
const _RESOURCE_COUNTER_SCHEMA = z.number().int().min(0).max(2_147_483_647);

/** Matches PostgreSQL BigInt storage without converting the amount through a lossy JS number. */
const _COST_MICROS_SCHEMA = z.bigint().min(0n).max(9_223_372_036_854_775_807n);

/** Rejects unknown resource fields and requires a reservation to account for some work. */
const _RESOURCES_SCHEMA: z.ZodType<RunTreeResources> = z.object({
	modelCalls: _RESOURCE_COUNTER_SCHEMA,
	completionTokens: _RESOURCE_COUNTER_SCHEMA,
	toolInvocations: _RESOURCE_COUNTER_SCHEMA,
	loopIterations: _RESOURCE_COUNTER_SCHEMA,
	costMicros: _COST_MICROS_SCHEMA,
}).strict().refine(_hasResources, "A resource allocation must contain a positive allowance");

/** Accepts root coordinates and a server-derived cost ceiling, never client-supplied snapshot limits. */
const _ROOT_COMMAND_SCHEMA: z.ZodType<RunTreeRootCommand> = z.object({
	siloId: _IDENTIFIER_SCHEMA,
	runId: _IDENTIFIER_SCHEMA,
	admissionKey: _IDENTIFIER_SCHEMA,
	effectiveCostCapMicros: _COST_MICROS_SCHEMA.refine(_isPositiveCost, "A root cost ceiling must be positive"),
}).strict();

/** Requires child model funding; database checks still bind the values to the child's saved snapshot. */
const _CHILD_COMMAND_SCHEMA: z.ZodType<RunTreeChildCommand> = z.object({
	siloId: _IDENTIFIER_SCHEMA,
	parentRunId: _IDENTIFIER_SCHEMA,
	runId: _IDENTIFIER_SCHEMA,
	admissionKey: _IDENTIFIER_SCHEMA,
	resources: _RESOURCES_SCHEMA.refine(_fundsChildModelWork, "A child needs positive model calls, completion tokens and cost"),
	deadlineAt: z.date(),
}).strict().refine(_hasDistinctParent, "A child cannot be its own parent");

/** Allows tool-only local work while rejecting empty, negative or unknown allowances. */
const _RESERVATION_COMMAND_SCHEMA: z.ZodType<RunTreeReservationCommand> = z.object({
	siloId: _IDENTIFIER_SCHEMA,
	runId: _IDENTIFIER_SCHEMA,
	reservationId: _IDENTIFIER_SCHEMA,
	idempotencyKey: _IDENTIFIER_SCHEMA,
	resources: _RESOURCES_SCHEMA,
}).strict();

/** Accepts only known closure reasons; the repository must verify the source's saved evidence. */
const _CLOSE_COMMAND_SCHEMA: z.ZodType<RunTreeCloseCommand> = z.object({
	siloId: _IDENTIFIER_SCHEMA,
	runId: _IDENTIFIER_SCHEMA,
	sourceRunId: _IDENTIFIER_SCHEMA,
	reason: z.nativeEnum(RunTreeClosureReasons),
}).strict();

/** Returns whether an allocation reserves at least one kind of work. */
function _hasResources(resources: RunTreeResources): boolean
{
	return resources.modelCalls > 0 || resources.completionTokens > 0 || resources.toolInvocations > 0
		|| resources.loopIterations > 0 || resources.costMicros > 0n;
}

/** Returns whether a root has a positive spending ceiling. */
function _isPositiveCost(costMicros: bigint): boolean
{
	return costMicros > 0n;
}

/** Returns whether the child can pay for a model request and its generated tokens. */
function _fundsChildModelWork(resources: RunTreeResources): boolean
{
	return resources.modelCalls > 0 && resources.completionTokens > 0 && resources.costMicros > 0n;
}

/** Rejects a direct cycle before lineage is checked against saved accounts. */
function _hasDistinctParent(command: RunTreeChildCommand): boolean
{
	return command.parentRunId !== command.runId;
}

/** Parses a root command without granting authority. @throws {z.ZodError} For an invalid command. */
export function _ParseRunTreeRootCommand(value: unknown): RunTreeRootCommand
{
	return _ROOT_COMMAND_SCHEMA.parse(value);
}

/** Parses a child command without checking persisted eligibility. @throws {z.ZodError} For an invalid command. */
export function _ParseRunTreeChildCommand(value: unknown): RunTreeChildCommand
{
	return _CHILD_COMMAND_SCHEMA.parse(value);
}

/** Parses local spending coordinates and allowances. @throws {z.ZodError} For an invalid command. */
export function _ParseRunTreeReservationCommand(value: unknown): RunTreeReservationCommand
{
	return _RESERVATION_COMMAND_SCHEMA.parse(value);
}

/** Parses closure coordinates without authorizing Stop. @throws {z.ZodError} For an invalid command. */
export function _ParseRunTreeCloseCommand(value: unknown): RunTreeCloseCommand
{
	return _CLOSE_COMMAND_SCHEMA.parse(value);
}
