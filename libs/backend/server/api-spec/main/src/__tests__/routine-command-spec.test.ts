import { describe, expect, it } from "vitest";

import { RoutineFiringReasons } from "@opencrane/contracts";

import { spec } from "../spec";

describe("routine command API contract", function _Suite()
{
	it("assembles the seven routine operations without private identity or replay fields", function _Routines()
	{
		expect(spec.paths).toHaveProperty("/me/routines.post");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}.get");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}/revise.post");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}/pause.post");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}/resume.post");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}/retire.post");
		expect(spec.paths).toHaveProperty("/me/routines/{routineId}/run-now.post");
		expect(spec.paths["/me/routines"]).not.toHaveProperty("get");

		const create = spec.paths["/me/routines"].post.responses[201].content["application/json"].schema.properties.routine;
		expect(create.properties).not.toHaveProperty("outcome");
		expect(create.properties).not.toHaveProperty("requesterIssuer");
		expect(create.properties).not.toHaveProperty("requesterSubjectId");
		expect(create.properties).not.toHaveProperty("requesterAuthenticatedAt");

		const firing = spec.paths["/me/routines/{routineId}/run-now"].post.responses[200].content["application/json"].schema.properties.firing;
		expect(firing.properties.reason.enum).toEqual([...Object.values(RoutineFiringReasons), null]);
		expect(firing.properties).not.toHaveProperty("outcome");
	});
});
