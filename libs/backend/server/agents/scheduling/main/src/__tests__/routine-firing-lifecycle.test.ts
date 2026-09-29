import { describe, expect, it } from "vitest";

import { RoutineFiringDisposition } from "@opencrane/models/agents";

import { __IsRoutineFiringUnfinished, __MayTransitionRoutineFiringProgress } from "../routine-firing-lifecycle";

describe("routine firing lifecycle", function _suite()
{
	it.each([
		[RoutineFiringDisposition.Preparing, true],
		[RoutineFiringDisposition.Running, true],
		[RoutineFiringDisposition.Waiting, true],
		[RoutineFiringDisposition.Uncertain, true],
		[RoutineFiringDisposition.Completed, false],
		[RoutineFiringDisposition.Failed, false],
		[RoutineFiringDisposition.Cancelled, false],
		[RoutineFiringDisposition.SkippedOverlap, false],
		[RoutineFiringDisposition.Refused, false],
	] as const)("classifies %s unfinished=%s", function _unfinished(disposition, expected)
	{
		expect(__IsRoutineFiringUnfinished(disposition)).toBe(expected);
	});

	it.each([
		RoutineFiringDisposition.Running,
		RoutineFiringDisposition.Completed,
		RoutineFiringDisposition.Failed,
		RoutineFiringDisposition.Cancelled,
	] as const)("allows uncertainty to resolve to %s", function _resolve(target)
	{
		expect(__MayTransitionRoutineFiringProgress(RoutineFiringDisposition.Uncertain, target)).toBe(true);
	});

	it.each([
		RoutineFiringDisposition.Preparing,
		RoutineFiringDisposition.Waiting,
		RoutineFiringDisposition.Uncertain,
		RoutineFiringDisposition.Refused,
		RoutineFiringDisposition.SkippedOverlap,
	] as const)("does not erase uncertainty by moving to %s", function _reject(target)
	{
		expect(__MayTransitionRoutineFiringProgress(RoutineFiringDisposition.Uncertain, target)).toBe(false);
	});
});
