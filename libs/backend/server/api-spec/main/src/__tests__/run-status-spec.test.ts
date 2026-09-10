import { describe, expect, it } from "vitest";

import { RunToolProgressPhases } from "@opencrane/contracts";

import { spec } from "../spec";

describe("personal run progress API contract", function _Suite()
{
	it("requires nullable phase-only progress without adding metadata or action controls", function _PhaseOnly()
	{
		const status = spec.components.schemas.SelfRunStatus;
		expect(status.required).toContain("latestTool");
		expect(status.properties.latestTool).toEqual({ type: "object", nullable: true, additionalProperties: false, required: ["phase"], properties: { phase: { type: "string", enum: Object.values(RunToolProgressPhases) } } });
	});
});
