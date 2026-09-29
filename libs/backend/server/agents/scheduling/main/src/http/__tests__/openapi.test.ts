import { describe, expect, it } from "vitest";

import { RoutineFiringReasons } from "@opencrane/contracts";

import { _RoutineOpenapiPaths } from "../openapi";

describe("routine OpenAPI fragment", function _Suite()
{
	it("describes authenticated command, read and preview operations with safe firing reasons", function _Contract()
	{
		expect(Object.keys(_RoutineOpenapiPaths)).toEqual([
			"/me/routines",
			"/me/routines/creation-options",
			"/me/routines/schedule-preview",
			"/me/routines/proposals/{proposalRef}",
			"/me/routines/{routineId}",
			"/me/routines/{routineId}/firings",
			"/me/routines/{routineId}/revise",
			"/me/routines/{routineId}/pause",
			"/me/routines/{routineId}/resume",
			"/me/routines/{routineId}/retire",
			"/me/routines/{routineId}/run-now",
		]);
		expect(_RoutineOpenapiPaths["/me/routines"]).toHaveProperty("get");
		expect(_RoutineOpenapiPaths["/me/routines"].post.requestBody.content["application/json"].schema.properties).toHaveProperty("proposalRef");
		expect(_RoutineOpenapiPaths["/me/routines/proposals/{proposalRef}"]).toHaveProperty("delete");
		const firing = _RoutineOpenapiPaths["/me/routines/{routineId}/run-now"].post.responses[200].content["application/json"].schema.properties.firing;
		expect(firing.properties.reason.enum).toEqual([...Object.values(RoutineFiringReasons), null]);
		expect(firing.properties).not.toHaveProperty("outcome");
		const history = _RoutineOpenapiPaths["/me/routines/{routineId}/firings"].get.responses[200].content["application/json"].schema.properties.items.items as { readonly required: readonly string[]; readonly properties: Record<string, unknown> };
		expect(history.required).toContain("createdAt");
		expect(history.required).toContain("runTerminalReason");
		expect(history.properties).toHaveProperty("actualCost");
		expect(history.properties).not.toHaveProperty("routineId");
	});
});
