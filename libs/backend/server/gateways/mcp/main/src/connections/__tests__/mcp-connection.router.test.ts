import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpConnectionStatus } from "@opencrane/contracts";

import { McpConnectionConflictError } from "../mcp-connection-admission";
import { McpConnectionOwnerKinds, type McpConnectionAuthority } from "../mcp-connection.types";
import { mcpConnectionRouter } from "../../routes/mcp-connection";

const _PROJECTION = { connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 3, credentialUpdatedAt: null, failureCode: null } as const;

describe("MCP connection routes", () =>
{
	it("passes bearer material only to the authenticated personal command and returns a safe projection", async () =>
	{
		const connect = vi.fn(async () => _PROJECTION);
		const response = await request(_App({ connect, revoke: vi.fn() })).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-token" } });

		expect(response.status).toBe(202);
		expect(response.body).toEqual(_PROJECTION);
		expect(JSON.stringify(response.body)).not.toContain("write-only-token");
		expect(connect).toHaveBeenCalledWith({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-token" } } });
	});

	it("rejects extra credential fields before authority admission", async () =>
	{
		const connect = vi.fn();
		const response = await request(_App({ connect, revoke: vi.fn() })).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None, token: "must-not-pass" } });

		expect(response.status).toBe(400);
		expect(connect).not.toHaveBeenCalled();
		expect(JSON.stringify(response.body)).not.toContain("must-not-pass");
	});

	it("requires a nullable safe generation before activation admission", async () =>
	{
		const connect = vi.fn();
		const app = _App({ connect, revoke: vi.fn() });

		const missing = await request(app).put("/installed/remote/connection").send({ idempotencyKey: "request-123", credential: { kind: McpConnectionCredentialKinds.None } });
		const zero = await request(app).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: 0, credential: { kind: McpConnectionCredentialKinds.None } });
		const unsafe = await request(app).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: Number.MAX_SAFE_INTEGER + 1, credential: { kind: McpConnectionCredentialKinds.None } });

		expect([missing.status, zero.status, unsafe.status]).toEqual([400, 400, 400]);
		expect(connect).not.toHaveBeenCalled();
	});

	it("rejects unbounded route identifiers before authority admission", async () =>
	{
		const connect = vi.fn();
		const response = await request(_App({ connect, revoke: vi.fn() })).put(`/installed/${"x".repeat(257)}/connection`).send({ idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } });

		expect(response.status).toBe(400);
		expect(connect).not.toHaveBeenCalled();
	});

	it("maps unavailable and conflicting commands without private evidence", async () =>
	{
		const unavailable = await request(_App({ connect: vi.fn(async () => null), revoke: vi.fn() })).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } });
		const conflict = await request(_App({ connect: vi.fn(async () => { throw new McpConnectionConflictError(); }), revoke: vi.fn() })).put("/installed/remote/connection").send({ idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } });

		expect(unavailable.status).toBe(404);
		expect(unavailable.body).toEqual({ error: "MCP connection is unavailable.", code: "MCP_CONNECTION_UNAVAILABLE" });
		expect(conflict.status).toBe(409);
		expect(conflict.body).toEqual({ error: "MCP connection command conflicts with the saved generation.", code: "MCP_CONNECTION_CONFLICT" });
	});

	it("passes the required positive revocation generation and rejects missing or unsafe values", async () =>
	{
		const revoke = vi.fn(async () => _PROJECTION);
		const app = _App({ connect: vi.fn(), revoke });

		const accepted = await request(app).delete("/installed/remote/connection").query({ commandId: "revoke-123", expectedGeneration: 3 });
		const missing = await request(app).delete("/installed/remote/connection").query({ commandId: "revoke-456" });
		const unsafe = await request(app).delete("/installed/remote/connection").query({ commandId: "revoke-789", expectedGeneration: Number.MAX_SAFE_INTEGER + 1 });

		expect(accepted.status).toBe(202);
		expect(revoke).toHaveBeenCalledWith({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", idempotencyKey: "revoke-123", expectedGeneration: 3 });
		expect(missing.status).toBe(400);
		expect(unsafe.status).toBe(400);
		expect(revoke).toHaveBeenCalledOnce();
	});
});

function _App(authority: Pick<McpConnectionAuthority, "connect" | "revoke">)
{
	const app = express();
	app.use(express.json());
	app.use(mcpConnectionRouter(authority, async () => ({ siloId: "silo-1", principalId: "principal-1" })));
	return app;
}
