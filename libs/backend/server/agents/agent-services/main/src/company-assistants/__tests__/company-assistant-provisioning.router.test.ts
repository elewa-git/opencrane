import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreateCompanyAssistantProvisioningRouter } from "../company-assistant-provisioning.router";
import { CompanyAssistantProvisioningDenied } from "../db/prisma-company-assistant-provisioning";

const _BODY = { name: "Company assistant", modelDefinitionId: "model-1", invokerPrincipalIds: ["human-1"] };
const _CALLER = { siloId: "silo-1", principalId: "admin" };

/** Mounts the real JSON route while retaining the domain boundary for authorization assertions. */
function _Fixture(authenticated = true)
{
	const provision = vi.fn().mockResolvedValue({ created: true, agentServiceId: "company", name: "Company assistant", principalId: "private-principal", identityEventId: "private-event" });
	const app = express();
	app.use(express.json());
	app.use(_CreateCompanyAssistantProvisioningRouter({ provision }, () => authenticated ? _CALLER : null, { warn: vi.fn() }));
	return { app, provision };
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
