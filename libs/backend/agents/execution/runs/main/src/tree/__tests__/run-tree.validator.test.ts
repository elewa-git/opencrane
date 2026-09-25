import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { RunTreeClosureReasons, type RunTreeChildCommand, type RunTreeReservationCommand, type RunTreeResources, type RunTreeRootCommand } from "../run-tree.types";
import { _ParseRunTreeChildCommand, _ParseRunTreeCloseCommand, _ParseRunTreeReservationCommand, _ParseRunTreeRootCommand } from "../run-tree.validator";

/** Supplies independently funded work without implying any child-count or concurrency limit. */
function _resources(): RunTreeResources
{
	return { modelCalls: 20, completionTokens: 10_000, toolInvocations: 30, loopIterations: 40, costMicros: 1_000_000n };
}

/** Supplies a backend root command with no client-controlled snapshot allowances. */
function _root(): RunTreeRootCommand
{
	return { siloId: "silo-1", runId: "root-1", admissionKey: "root-admission-1", effectiveCostCapMicros: 5_000_000n };
}

/** Supplies a child allocation whose saved snapshot and ancestors are checked by the repository. */
function _child(): RunTreeChildCommand
{
	return { siloId: "silo-1", parentRunId: "parent-1", runId: "child-1", admissionKey: "child-admission-1", resources: _resources(), deadlineAt: new Date("2026-09-23T13:00:00.000Z") };
}

/** Supplies a local work reservation with a stable retry key. */
function _reservation(): RunTreeReservationCommand
{
	return { siloId: "silo-1", runId: "run-1", reservationId: "reservation-1", idempotencyKey: "local-work-1", resources: _resources() };
}

describe("run-tree command validation", function _RunTreeCommandValidation()
{
	it("retains root coordinates and a lossless bigint server ceiling", function _RootCommand()
	{
		const command = { ..._root(), effectiveCostCapMicros: 9_007_199_254_740_993n };
		expect(_ParseRunTreeRootCommand(command)).toEqual(command);
	});

	it.each([0n, -1n, 9_223_372_036_854_775_808n, 1, "1", Infinity])("rejects invalid root cost %s", function _RootCost(value)
	{
		expect(function _Parse() { _ParseRunTreeRootCommand({ ..._root(), effectiveCostCapMicros: value }); }).toThrow(ZodError);
	});

	it.each(["", " ", "\t\n"])("rejects blank identifiers %j", function _BlankIdentifier(identifier)
	{
		expect(function _Root() { _ParseRunTreeRootCommand({ ..._root(), siloId: identifier }); }).toThrow(ZodError);
		expect(function _Child() { _ParseRunTreeChildCommand({ ..._child(), parentRunId: identifier }); }).toThrow(ZodError);
		expect(function _Reserve() { _ParseRunTreeReservationCommand({ ..._reservation(), idempotencyKey: identifier }); }).toThrow(ZodError);
		expect(function _Close() { _ParseRunTreeCloseCommand({ siloId: "silo-1", runId: "run-1", sourceRunId: identifier, reason: RunTreeClosureReasons.AuthorizedStop }); }).toThrow(ZodError);
	});

	it("preserves nonblank identifier bytes for admission digest stability", function _PreserveIdentifiers()
	{
		const command = { ..._root(), admissionKey: " admission-with-spaces " };
		expect(_ParseRunTreeRootCommand(command).admissionKey).toBe(command.admissionKey);
	});

	it("accepts funded children without depth, count or concurrency fields", function _ChildCommand()
	{
		const command = _child();
		expect(_ParseRunTreeChildCommand(command)).toEqual(command);
	});

	it.each(["modelCalls", "completionTokens", "costMicros"])("requires positive child funding for %s", function _ChildFunding(field)
	{
		const value = field === "costMicros" ? 0n : 0;
		expect(function _Parse() { _ParseRunTreeChildCommand({ ..._child(), resources: { ..._resources(), [field]: value } }); }).toThrow(ZodError);
	});

	it("rejects a direct parent cycle", function _SelfParent()
	{
		expect(function _Parse() { _ParseRunTreeChildCommand({ ..._child(), parentRunId: "child-1" }); }).toThrow(ZodError);
	});

	it.each([new Date("invalid"), "2026-09-23T13:00:00.000Z", null])("rejects invalid or converted deadlines %s", function _Deadline(value)
	{
		expect(function _Parse() { _ParseRunTreeChildCommand({ ..._child(), deadlineAt: value }); }).toThrow(ZodError);
	});

	it("leaves deadline eligibility to the repository's clock and persisted evidence", function _PastDeadlineShape()
	{
		const command = { ..._child(), deadlineAt: new Date("2000-01-01T00:00:00.000Z") };
		expect(_ParseRunTreeChildCommand(command).deadlineAt).toEqual(command.deadlineAt);
	});

	it("allows a tool-only reservation without minting model authority", function _ToolOnlyReservation()
	{
		const command = { ..._reservation(), resources: { modelCalls: 0, completionTokens: 0, toolInvocations: 1, loopIterations: 0, costMicros: 0n } };
		expect(_ParseRunTreeReservationCommand(command)).toEqual(command);
	});

	it("rejects an empty reservation", function _EmptyReservation()
	{
		const resources = { modelCalls: 0, completionTokens: 0, toolInvocations: 0, loopIterations: 0, costMicros: 0n };
		expect(function _Parse() { _ParseRunTreeReservationCommand({ ..._reservation(), resources }); }).toThrow(ZodError);
	});

	it.each(["modelCalls", "completionTokens", "toolInvocations", "loopIterations"])("enforces lossless nonnegative Int storage for %s", function _ResourceCounter(field)
	{
		for (const value of [-1, 1.5, NaN, Infinity, 2_147_483_648, "1", 1n])
		{
			expect(function _Parse() { _ParseRunTreeReservationCommand({ ..._reservation(), resources: { ..._resources(), [field]: value } }); }).toThrow(ZodError);
		}
		const command = { ..._reservation(), resources: { ..._resources(), [field]: 2_147_483_647 } };
		expect(_ParseRunTreeReservationCommand(command)).toEqual(command);
	});

	it.each([-1n, 9_223_372_036_854_775_808n, 0, "0"])("rejects invalid reservation cost %s", function _ReservationCost(value)
	{
		expect(function _Parse() { _ParseRunTreeReservationCommand({ ..._reservation(), resources: { ..._resources(), costMicros: value } }); }).toThrow(ZodError);
	});

	it("accepts the bigint storage boundary without rounding it", function _BigIntBoundary()
	{
		const command = { ..._reservation(), resources: { ..._resources(), costMicros: 9_223_372_036_854_775_807n } };
		expect(_ParseRunTreeReservationCommand(command).resources.costMicros).toBe(9_223_372_036_854_775_807n);
	});

	it.each(Object.values(RunTreeClosureReasons))("accepts the known closure reason %s", function _ClosureReason(reason)
	{
		const command = { siloId: "silo-1", runId: "child-1", sourceRunId: "root-1", reason };
		expect(_ParseRunTreeCloseCommand(command)).toEqual(command);
	});

	it("rejects unknown closure reasons", function _UnknownClosureReason()
	{
		expect(function _Parse() { _ParseRunTreeCloseCommand({ siloId: "silo-1", runId: "run-1", sourceRunId: "root-1", reason: "kill_all" }); }).toThrow(ZodError);
	});

	it("rejects additional top-level and resource fields instead of accepting extra authority", function _StrictCommands()
	{
		expect(function _Root() { _ParseRunTreeRootCommand({ ..._root(), resources: _resources() }); }).toThrow(ZodError);
		expect(function _Child() { _ParseRunTreeChildCommand({ ..._child(), maxDepth: 2 }); }).toThrow(ZodError);
		expect(function _Reserve() { _ParseRunTreeReservationCommand({ ..._reservation(), approved: true }); }).toThrow(ZodError);
		expect(function _Resources() { _ParseRunTreeReservationCommand({ ..._reservation(), resources: { ..._resources(), children: 4 } }); }).toThrow(ZodError);
		expect(function _Close() { _ParseRunTreeCloseCommand({ siloId: "silo-1", runId: "run-1", sourceRunId: "root-1", reason: RunTreeClosureReasons.AuthorizedStop, stopped: true }); }).toThrow(ZodError);
	});
});
