import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateCompanyAssistantProvisioningRouter } from "../company-assistant-provisioning.router";
import { CompanyAssistantProvisioningDenied, CompanyAssistantToolsConflict, CompanyAssistantToolsUnavailable } from "../db/prisma-company-assistant-provisioning";

const _BODY = { name: "Company assistant", modelDefinitionId: "model-1", invokerPrincipalIds: ["human-1"] };
const _CALLER = { siloId: "silo-1", principalId: "admin" };

/** Mounts the real JSON route while retaining the domain boundary for authorization assertions. */
function _Fixture(authenticated = true)
{
	const provision = vi.fn().mockResolvedValue({ created: true, agentServiceId: "company", name: "Company assistant", principalId: "private-principal", identityEventId: "private-event" });
	const getTools = vi.fn().mockResolvedValue({ agentServiceId: "company", activeRevisionId: "revision-1", toolRevisionIds: ["tool-1"] });
	const setTools = vi.fn().mockResolvedValue({ agentServiceId: "company", activeRevisionId: "revision-2", toolRevisionIds: ["tool-2"] });
	const app = express();
	app.use(express.json());
	app.use(_CreateCompanyAssistantProvisioningRouter({ provision, getTools, setTools }, () => authenticated ? _CALLER : null, { warn: vi.fn() }));
	return { app, provision, getTools, setTools };
}

describe("company assistant provisioning HTTP contract", function _Suite()
{
	it("passes only trusted caller coordinates and returns a small public result", async function _Creates()
	{
		const f = _Fixture();
		const response = await request(f.app).post("/").send(_BODY).expect(201);
		expect(f.provision).toHaveBeenCalledExactlyOnceWith(_CALLER, _BODY);
		expect(response.body).toEqual({ created: true, assistant: { agentServiceId: "company", displayName: "Company assistant" } });
		expect(response.headers["cache-control"]).toBe("no-store");
	});

	it.each([{ ..._BODY, siloId: "other" }, { ..._BODY, principalId: "other" }, { ..._BODY, invokerPrincipalIds: ["same", "same"] }, { ..._BODY, invokerPrincipalIds: [] }, { ..._BODY, name: " " }])("rejects identity injection or invalid choices before domain admission", async function _RejectsBody(body)
	{
		const f = _Fixture();
		await request(f.app).post("/").send(body).expect(400);
		expect(f.provision).not.toHaveBeenCalled();
	});

	it("requires authentication before accessing setup authority", async function _RequiresCaller()
	{
		const f = _Fixture(false);
		await request(f.app).post("/").send(_BODY).expect(401);
		expect(f.provision).not.toHaveBeenCalled();
	});

	it("distinguishes an existing unchanged assistant and conceals refused authority details", async function _ExistingAndDenied()
	{
		const f = _Fixture();
		f.provision.mockResolvedValue({ created: false, agentServiceId: "company", name: "Original name" });
		const response = await request(f.app).post("/").send(_BODY).expect(200);
		expect(response.body).toEqual({ created: false, assistant: { agentServiceId: "company", displayName: "Original name" } });
		f.provision.mockRejectedValue(new CompanyAssistantProvisioningDenied());
		expect((await request(f.app).post("/").send(_BODY).expect(403)).body).toEqual({ error: "company_assistant_setup_denied" });
	});
});


describe("company assistant tool assignment HTTP contract", function _ToolsSuite()
{
	it("reads and replaces only the trusted caller's exact selection", async function _UsesCaller()
	{
		const f = _Fixture();
		const current = await request(f.app).get("/tools").expect(200);
		expect(current.body).toEqual({ agentServiceId: "company", activeRevisionId: "revision-1", toolRevisionIds: ["tool-1"] });
		expect(current.headers["cache-control"]).toBe("no-store");
		expect(f.getTools).toHaveBeenCalledExactlyOnceWith(_CALLER);
		const body = { expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-2"] };
		const replaced = await request(f.app).put("/tools").send(body).expect(200);
		expect(replaced.body).toEqual({ agentServiceId: "company", activeRevisionId: "revision-2", toolRevisionIds: ["tool-2"] });
		expect(replaced.headers["cache-control"]).toBe("no-store");
		expect(f.setTools).toHaveBeenCalledExactlyOnceWith(_CALLER, body);
	});

	it.each([
		{ toolRevisionIds: [] }, { expectedActiveRevisionId: " ", toolRevisionIds: [] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: ["duplicate", "duplicate"] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: [" tool"] },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: Array.from({ length: 33 }, (_, index) => `tool-${index}`) },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: [], principalId: "human" },
		{ expectedActiveRevisionId: "revision-1", toolRevisionIds: [], credential: "private" },
	])("rejects malformed, oversized or authority-bearing input %j", async function _Rejects(body)
	{
		const f = _Fixture();
		await request(f.app).put("/tools").send(body).expect(400);
		expect(f.setTools).not.toHaveBeenCalled();
	});

	it("accepts an empty selection and preserves conflict as a refresh requirement", async function _ClearsAndConflicts()
	{
		const f = _Fixture();
		const body = { expectedActiveRevisionId: "revision-1", toolRevisionIds: [] };
		await request(f.app).put("/tools").send(body).expect(200);
		expect(f.setTools).toHaveBeenCalledExactlyOnceWith(_CALLER, body);
		f.setTools.mockRejectedValue(new CompanyAssistantToolsConflict());
		expect((await request(f.app).put("/tools").send(body).expect(409)).body).toEqual({ error: "company_assistant_revision_changed" });
	});

	it("requires authentication before reading or replacing tools", async function _RequiresCaller()
	{
		const f = _Fixture(false);
		await request(f.app).get("/tools").expect(401);
		await request(f.app).put("/tools").send({ expectedActiveRevisionId: "revision-1", toolRevisionIds: [] }).expect(401);
		expect(f.getTools).not.toHaveBeenCalled();
		expect(f.setTools).not.toHaveBeenCalled();
	});

	it.each([
		{ error: new CompanyAssistantProvisioningDenied(), status: 403 },
		{ error: new CompanyAssistantToolsUnavailable(), status: 404 },
		{ error: new Error("private dependency details"), status: 503 },
	])("conceals refused or unavailable authority at status $status", async function _Conceals({ error, status })
	{
		const f = _Fixture();
		f.getTools.mockRejectedValue(error);
		f.setTools.mockRejectedValue(error);
		const read = await request(f.app).get("/tools").expect(status);
		const write = await request(f.app).put("/tools").send({ expectedActiveRevisionId: "revision-1", toolRevisionIds: [] }).expect(status);
		expect(JSON.stringify([read.body, write.body])).not.toContain(error.message);
	});
});
