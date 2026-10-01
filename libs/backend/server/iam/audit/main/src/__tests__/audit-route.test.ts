import express from "express";
import request from "supertest";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { _AuditOpenapiPaths, _AuditOpenapiSchemas } from "../openapi";
import { _DecodeAuditCursor, _EncodeAuditCursor } from "../routes/audit-cursor";
import { auditRouter } from "../routes/audit";

/** Authenticated caller fixture resolved outside request-controlled input. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1" } as const;

/** Builds a router app with a transaction and authority that expose every candidate. */
function _App(rows: readonly { readonly id: number; readonly timestamp: Date; readonly action: string; readonly resource: string; readonly message: string }[], caller: typeof _CALLER | null = _CALLER)
{
	const transaction = { auditEntry: { findMany: vi.fn().mockResolvedValue(rows) } } as unknown as Prisma.TransactionClient;
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
	const authorization = { listPrincipalEntitled: vi.fn(async function _Authorize(command) { return command.resources; }) } as unknown as AuthorizationAuthority;
	const app = express();
	app.use("/api/v1/audit", auditRouter(prisma, function _CreateAuthorization() { return authorization; }, function _ResolveCaller() { return caller; }));
	return { app, transaction };
}

describe("auditRouter", function _Suite()
{
	it("round-trips both descending-order coordinates through the opaque cursor", async function _RoundTripsCursor()
	{
		const rows = [
			{ id: 8, timestamp: new Date("2026-08-29T10:00:00.000Z"), action: "Updated", resource: "Group/eight", message: "updated" },
			{ id: 7, timestamp: new Date("2026-08-29T10:00:00.000Z"), action: "Created", resource: "Group/seven", message: "created" },
		];
		const first = _App(rows);
		const response = await request(first.app).get("/api/v1/audit?limit=1");

		expect(response.status).toBe(200);
		expect(response.body.pagination.hasMore).toBe(true);
		expect(_DecodeAuditCursor(response.body.pagination.nextCursor)).toEqual({ timestamp: rows[0].timestamp, id: 8 });

		const second = _App([]);
		const cursor = _EncodeAuditCursor({ timestamp: rows[0].timestamp, id: 8 });
		expect((await request(second.app).get(`/api/v1/audit?limit=1&cursor=${cursor}`)).status).toBe(200);
		expect(second.transaction.auditEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", OR: [{ timestamp: { lt: rows[0].timestamp } }, { timestamp: rows[0].timestamp, id: { lt: 8 } }] } }));
	});

	it("clamps a positive fractional limit to one and advances the cursor", async function _ClampsFractionalLimit()
	{
		const rows = [
			{ id: 8, timestamp: new Date("2026-08-29T10:00:00.000Z"), action: "Updated", resource: "Group/eight", message: "updated" },
			{ id: 7, timestamp: new Date("2026-08-29T10:00:00.000Z"), action: "Created", resource: "Group/seven", message: "created" },
		];
		const { app, transaction } = _App(rows);
		const response = await request(app).get("/api/v1/audit?limit=.5");

		expect(response.status).toBe(200);
		expect(response.body.data).toHaveLength(1);
		expect(response.body.pagination).toMatchObject({ limit: 1, hasMore: true });
		expect(_DecodeAuditCursor(response.body.pagination.nextCursor)).toEqual({ timestamp: rows[0].timestamp, id: 8 });
		expect(transaction.auditEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
	});

	it.each([
		"not-base64url!",
		"a".repeat(513),
		Buffer.from("2026-08-29T10:00:00.000Z", "utf8").toString("base64url"),
		Buffer.from(JSON.stringify({ timestamp: "2026-08-29T10:00:00.000Z" }), "utf8").toString("base64url"),
		Buffer.from(JSON.stringify({ timestamp: "2026-08-29T10:00:00.000Z", id: 8, extra: true }), "utf8").toString("base64url"),
		Buffer.from(JSON.stringify({ timestamp: "2026-08-29", id: 8 }), "utf8").toString("base64url"),
		Buffer.from(JSON.stringify({ timestamp: "2026-08-29T10:00:00.000Z", id: 0 }), "utf8").toString("base64url"),
		Buffer.from(JSON.stringify({ timestamp: "2026-08-29T10:00:00.000Z", id: 2_147_483_648 }), "utf8").toString("base64url"),
	])("denies malformed cursor %s", async function _RejectsCursor(cursor)
	{
		const { app, transaction } = _App([]);
		const response = await request(app).get(`/api/v1/audit?cursor=${encodeURIComponent(cursor)}`);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Audit cursor is invalid", code: "INVALID_CURSOR" });
		expect(transaction.auditEntry.findMany).not.toHaveBeenCalled();
	});

	it("keeps the missing-Principal denial ahead of catalogue access", async function _RejectsMissingPrincipal()
	{
		const { app, transaction } = _App([], null);
		const response = await request(app).get("/api/v1/audit");

		expect(response.status).toBe(403);
		expect(response.body).toEqual({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
		expect(transaction.auditEntry.findMany).not.toHaveBeenCalled();
	});

	it("publishes required runtime audit fields and malformed-cursor denial", function _OpenapiContract()
	{
		expect(_AuditOpenapiSchemas.AuditEntry.required).toEqual(["timestamp", "action", "resource", "message"]);
		expect(_AuditOpenapiPaths["/audit"].get.responses).toHaveProperty("400");
		expect(_AuditOpenapiPaths["/audit"].get.responses).toHaveProperty("403");
	});
});
