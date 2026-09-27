import { describe, expect, it } from "vitest";

import { RoutineFiringReasons } from "@opencrane/contracts";

import { _RoutineOpenapiPaths } from "../openapi";

describe("routine OpenAPI fragment", function _Suite()
{
	it("describes only the seven authenticated authority operations and safe firing reasons", function _Contract()
	{
		expect(Object.keys(_RoutineOpenapiPaths)).toEqual([
			"/me/routines",
			"/me/routines/{routineId}",
			"/me/routines/{routineId}/revise",
			"/me/routines/{routineId}/pause",
			"/me/routines/{routineId}/resume",
			"/me/routines/{routineId}/retire",
			"/me/routines/{routineId}/run-now",
		]);
		expect(_RoutineOpenapiPaths["/me/routines"]).not.toHaveProperty("get");
		const firing = _RoutineOpenapiPaths["/me/routines/{routineId}/run-now"].post.responses[200].content["application/json"].schema.properties.firing;
		expect(firing.properties.reason.enum).toEqual([...Object.values(RoutineFiringReasons), null]);
		expect(firing.properties).not.toHaveProperty("outcome");
	});
});
