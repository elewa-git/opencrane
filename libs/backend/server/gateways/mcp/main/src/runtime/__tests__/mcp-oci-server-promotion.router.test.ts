import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateMcpOciServerPromotionRouter } from "../mcp-oci-server-promotion.router";
import type { McpOciServerPromotionRouterDependencies } from "../mcp-runtime.types";

/** Build public router dependencies with one authenticated administrator caller. */
function _Dependencies(overrides: Partial<McpOciServerPromotionRouterDependencies> = {}): McpOciServerPromotionRouterDependencies
{
	return {
		authority: { promoteImportedValidation: vi.fn().mockResolvedValue({ outcome: "created", serverId: "server-1", serverRevisionId: "revision-1", executionId: "execution-1" }) },
		resolveCaller: vi.fn().mockResolvedValue({ siloId: "silo-a", principalId: "principal-1" }),
		logger: { error: vi.fn() },
		...overrides,
	} as never;
}

/** Mount the router; the authority resolves product administration inside its transaction. */
function _App(dependencies: McpOciServerPromotionRouterDependencies)
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/mcp", __CreateMcpOciServerPromotionRouter(dependencies));
	return app;
}

/** Valid bounded promotion input. */
const _COMMAND = { name: "Calendar MCP", description: "Pinned calendar tools" };

describe("MCP OCI server promotion router", function _DescribeRouter()
{
	it("requires a durable local caller before parsing promotion input", async function _RequiresCaller()
	{
		const dependencies = _Dependencies({ resolveCaller: vi.fn().mockResolvedValue(null) });
		const response = await request(_App(dependencies)).post("/api/v1/mcp/oci-image-validations/validation-1/server").send({ unexpected: true });

		expect(response.status).toBe(401);
		expect(dependencies.resolveCaller).toHaveBeenCalledOnce();
		expect(dependencies.authority.promoteImportedValidation).not.toHaveBeenCalled();
	});

	it("binds promotion to the resolved caller and returns the created coordinates", async function _Promotes()
	{
		const dependencies = _Dependencies();
		const response = await request(_App(dependencies)).post("/api/v1/mcp/oci-image-validations/validation-1/server").send(_COMMAND);

		expect(response.status).toBe(201);
		expect(response.body).toEqual({ outcome: "created", serverId: "server-1", serverRevisionId: "revision-1", executionId: "execution-1" });
		expect(dependencies.authority.promoteImportedValidation).toHaveBeenCalledWith({ siloId: "silo-a", principalId: "principal-1" }, "validation-1", _COMMAND);
	});

	it("maps missing, unimported, conflicting, and idempotent authority outcomes", async function _MapsOutcomes()
	{
		const promoteImportedValidation = vi.fn()
			.mockResolvedValueOnce({ outcome: "not_found" })
			.mockResolvedValueOnce({ outcome: "not_imported" })
			.mockResolvedValueOnce({ outcome: "conflict" })
			.mockResolvedValueOnce({ outcome: "idempotent", serverId: "server-1", serverRevisionId: "revision-1", executionId: "execution-1" });
		const app = _App(_Dependencies({ authority: { promoteImportedValidation } as never }));

		expect((await request(app).post("/api/v1/mcp/oci-image-validations/missing/server").send(_COMMAND)).status).toBe(404);
		expect((await request(app).post("/api/v1/mcp/oci-image-validations/pending/server").send(_COMMAND)).status).toBe(409);
		expect((await request(app).post("/api/v1/mcp/oci-image-validations/conflict/server").send(_COMMAND)).status).toBe(409);
		expect((await request(app).post("/api/v1/mcp/oci-image-validations/current/server").send(_COMMAND)).status).toBe(200);
	});

	it("rejects extra promotion authority fields", async function _RejectsExtraFields()
	{
		const dependencies = _Dependencies();
		const response = await request(_App(dependencies)).post("/api/v1/mcp/oci-image-validations/validation-1/server").send({ ..._COMMAND, siloId: "attacker-silo" });

		expect(response.status).toBe(400);
		expect(dependencies.authority.promoteImportedValidation).not.toHaveBeenCalled();
	});
});
