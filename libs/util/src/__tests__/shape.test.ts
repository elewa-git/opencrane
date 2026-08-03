import { describe, expect, it } from "vitest";

import { ___IsBoundedIdentifier, ___IsMillisecondInstant, ___IsPositiveInteger, ___ParseShape, ___RequireField, ___ShapeFields } from "../shape.js";

describe("shape predicates", function _DescribeShapePredicates()
{
	it("accepts only bounded control-character-free identifiers", function _BoundsIdentifiers()
	{
		expect(___IsBoundedIdentifier("run-1")).toBe(true);
		expect(___IsBoundedIdentifier("")).toBe(false);
		expect(___IsBoundedIdentifier("a".repeat(257))).toBe(false);
		expect(___IsBoundedIdentifier("line\nbreak")).toBe(false);
		expect(___IsBoundedIdentifier(7)).toBe(false);
	});

	it("accepts only positive safe integers", function _BoundsIntegers()
	{
		expect(___IsPositiveInteger(1)).toBe(true);
		expect(___IsPositiveInteger(0)).toBe(false);
		expect(___IsPositiveInteger(1.5)).toBe(false);
		expect(___IsPositiveInteger("1")).toBe(false);
	});

	it("accepts only canonical UTC millisecond instants", function _BoundsInstants()
	{
		expect(___IsMillisecondInstant("2026-08-03T10:00:00.000Z")).toBe(true);
		expect(___IsMillisecondInstant("2026-08-03T10:00:00Z")).toBe(false);
		expect(___IsMillisecondInstant("2026-13-40T10:00:00.000Z")).toBe(false);
	});
});

describe("___ParseShape", function _DescribeParseShape()
{
	it("returns exactly the declared, validated fields", function _ReturnsDeclaredFields()
	{
		const parsed = ___ParseShape({ runId: "run-1", attempt: 2, extra: "dropped" }, "claim", { runId: ___ShapeFields.identifier, attempt: ___ShapeFields.positiveInteger });

		expect(parsed).toEqual({ runId: "run-1", attempt: 2 });
	});

	it("names the exact offending field path in its diagnostic", function _NamesOffendingField()
	{
		expect(function _parseBadAttempt() { ___ParseShape({ runId: "run-1", attempt: 0 }, "claim", { runId: ___ShapeFields.identifier, attempt: ___ShapeFields.positiveInteger }); }).toThrow("claim.attempt must be a positive integer");
	});

	it("rejects a non-object candidate before any field parsing", function _RejectsNonObject()
	{
		expect(function _parseArray() { ___ParseShape([], "claim", { runId: ___ShapeFields.identifier }); }).toThrow("claim must be a JSON object");
	});

	it("composes nested shapes through field parsers", function _ComposesNestedShapes()
	{
		const parsed = ___ParseShape({ lease: { eventId: "event-1" } }, "claim", {
			lease: function _parseLease(value: unknown, path: string) { return ___ParseShape(value, path, { eventId: ___ShapeFields.identifier }); },
		});

		expect(parsed).toEqual({ lease: { eventId: "event-1" } });
		expect(function _parseBadLease() { ___ParseShape({ lease: { eventId: "" } }, "claim", { lease: function _parseLease(value: unknown, path: string) { return ___ParseShape(value, path, { eventId: ___ShapeFields.identifier }); } }); }).toThrow("claim.lease.eventId must be a bounded identifier");
	});

	it("builds custom field parsers from a predicate and requirement", function _BuildsCustomFields()
	{
		const bounded = ___RequireField(function _isSmall(value: unknown): value is number { return typeof value === "number" && value <= 10; }, "at most 10");

		expect(bounded(3, "result.count")).toBe(3);
		expect(function _parseLarge() { bounded(11, "result.count"); }).toThrow("result.count must be at most 10");
	});
});
