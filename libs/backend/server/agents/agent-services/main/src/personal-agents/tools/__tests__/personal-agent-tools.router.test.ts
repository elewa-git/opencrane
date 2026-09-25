import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { PersonalAgentToolsConflict, PersonalAgentToolsDenied, PersonalAgentToolsUnavailable } from "../personal-agent-tools.errors";
import { _CreatePersonalAgentToolsRouter } from "../personal-agent-tools.router";

const _CALLER = { siloId: "silo-1", subjectId: "subject-1" } as const;
const _SELECTION = { agentServiceId: "service-1", activeRevisionId: "revision-1", toolRevisionIds: ["tool-1"] } as const;

/** Creates an isolated route with explicit caller and authority seams. */
function _Fixture(authenticated = true)
{
	const getTools = vi.fn().mockResolvedValue(_SELECTION);
	const setTools = vi.fn().mockResolvedValue({ ..._SELECTION, activeRevisionId: "revision-2" });
	const warn = vi.fn();
	const app = express();
	app.use(express.json());
	app.use(_CreatePersonalAgentToolsRouter({ getTools, setTools }, function _Resolve() { return authenticated ? _CALLER : null; }, { warn }));
	return { app, getTools, setTools, warn };
}

describe("personal agent tool HTTP contract", function _Suite()
{
	it("reads and replaces only the trusted caller's exact selection", async function _ReadsAndWrites()
	{
		const f = _Fixture();
		const read = await request(f.app).get("/").expect(200);
		expect(read.body).toEqual(_SELECTION);
		expect(read.headers["cache-control"]).toBe("no-store");
		expect(f.getTools).toHaveBeenCalledExactlyOnceWith(_CALLER);
		const body = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-1"] };
		await request(f.app).put("/").send(body).expect(200);
		expect(f.setTools).toHaveBeenCalledExactlyOnceWith(_CALLER, body);
	});

	it.each([
		{},
		{ expectedActiveRevisionId: " ", toolRevisionIds: [] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: ["duplicate", "duplicate"] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: [" tool"] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: [], principalId: "principal-1" },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: Array.from({ length: 33 }, (_, index) => `tool-${index}`) },
	])("rejects malformed or authority-bearing input %#", async function _Rejects(body)
	{
		const f = _Fixture();
		await request(f.app).put("/").send(body).expect(400);
		expect(f.setTools).not.toHaveBeenCalled();
	});

	it("accepts an empty replacement and maps a stale revision to conflict", async function _ClearsAndConflicts()
	{
		const f = _Fixture();
		const body = { expectedActiveRevisionId: "revision-1", toolRevisionIds: [] };
		await request(f.app).put("/").send(body).expect(200);
		f.setTools.mockRejectedValue(new PersonalAgentToolsConflict());
		await request(f.app).put("/").send(body).expect(409, { error: "personal_agent_revision_changed" });
	});

	it("requires authenticated request facts for both methods", async function _RequiresCaller()
	{
		const f = _Fixture(false);
		await request(f.app).get("/").expect(401);
		await request(f.app).put("/").send({ expectedActiveRevisionId: "revision-1", toolRevisionIds: [] }).expect(401);
		expect(f.getTools).not.toHaveBeenCalled();
		expect(f.setTools).not.toHaveBeenCalled();
	});

	it.each([[new PersonalAgentToolsDenied(), 403], [new PersonalAgentToolsUnavailable(), 404], [new Error("private persistence detail"), 503]] as const)("conceals domain failure at status %s", async function _Conceals(error, status)
	{
		const f = _Fixture();
		f.getTools.mockRejectedValue(error);
		f.setTools.mockRejectedValue(error);
		const read = await request(f.app).get("/").expect(status);
		const write = await request(f.app).put("/").send({ expectedActiveRevisionId: "revision-1", toolRevisionIds: [] }).expect(status);
		expect(JSON.stringify([read.body, write.body])).not.toContain(error.message);
	});
});
