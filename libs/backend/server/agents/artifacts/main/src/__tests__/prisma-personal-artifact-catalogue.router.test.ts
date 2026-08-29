import { ArtifactIndexState, ArtifactKind, ArtifactState, type PrismaClient } from "@prisma/client";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Logger } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { _CreatePersonalArtifactCatalogueRouter } from "../prisma-personal-artifact-catalogue.router";

const _listPrincipalEntitled = vi.hoisted(function _AuthorizationSpy() { return vi.fn(); });

/** Builds one lifecycle-eligible artifact row for paged catalogue tests. */
function _ArtifactRow(id: string, updatedAt: Date): object
{
	return { id, kind: ArtifactKind.Document, state: ArtifactState.Active, currentRevisionId: `revision-${id}`, currentRevision: { mediaType: "text/plain", byteLength: 12n, indexState: ArtifactIndexState.Indexed }, createdAt: updatedAt, updatedAt };
}

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return { PrismaAuthorizationAuthority: class { async listPrincipalEntitled(command: { readonly resources: readonly object[] }) { return _listPrincipalEntitled(command); } } };
});

/** Builds the public route with a deterministic browser session and persistence adapter. */
function _app(principalId: string | null, prisma: PrismaClient): ReturnType<typeof express>
{
	const app = express();
	app.use(function _seedSession(incoming: Request, _response: Response, next: NextFunction): void
	{
		if (principalId === null)
		{
			(incoming as unknown as { session: undefined }).session = undefined;
			next();
			return;
		}
		(incoming as unknown as { session: { authUser: Readonly<Record<string, unknown>> } }).session = {
			authUser: { authenticatedAt: "2026-01-01T00:00:00.000Z" },
		};
		incoming.authenticatedPrincipal = { principalId, siloId: "silo-1", issuer: "https://issuer.test", subject: "subject-1" };
		next();
	});
	app.use("/api/v1/me/assets", _CreatePersonalArtifactCatalogueRouter(prisma, { error: vi.fn() } as unknown as Logger));
	return app;
}

describe("personal artifact catalogue Prisma router", function _suite()
{
	it("derives the exact silo from the host and uses the admitted Principal as owner", async function _derivesCaller()
	{
		_listPrincipalEntitled.mockImplementationOnce(function _Entitled(command: { readonly resources: readonly object[] }) { return command.resources; });
		const findMany = vi.fn().mockResolvedValue([]);
		const transaction = { artifact: { findMany } };
		const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) } as unknown as PrismaClient;

		const response = await request(_app("principal-1", prisma))
			.get("/api/v1/me/assets/")
			.set("x-forwarded-host", "silo-1.dev.opencrane.ai");

		expect(response.status).toBe(200);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", state: expect.any(Object) }) }));
		expect(_listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1" }));
		expect(_listPrincipalEntitled.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
	});

	it("denies a request without an admitted Principal", async function _deniesMissingPrincipal()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;
		const denied = await request(_app(null, prisma)).get("/api/v1/me/assets/").set("x-forwarded-host", "silo-1.dev.opencrane.ai");
		expect(denied.status).toBe(401);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("continues past fifty unrelated artifacts to return a Group-entitled artifact", async function _PaginatesBeforeFiltering()
	{
		const secondPageCursor = new Date("2026-08-28T10:10:00.000Z");
		const firstPage = Array.from({ length: 50 }, function _Row(_value, index) { return _ArtifactRow(`foreign-${50 - index}`, new Date(`2026-08-28T10:${String(59 - index).padStart(2, "0")}:00.000Z`)); });
		const entitledRow = _ArtifactRow("group-entitled", new Date("2026-08-28T09:00:00.000Z"));
		const findMany = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([entitledRow]);
		const transaction = { artifact: { findMany } };
		const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) } as unknown as PrismaClient;
		_listPrincipalEntitled.mockImplementation(function _Entitled(command: { readonly resources: readonly { readonly id: string }[] })
		{
			return command.resources.filter(resource => resource.id === "group-entitled");
		});

		const response = await request(_app("principal-1", prisma)).get("/api/v1/me/assets/").set("x-forwarded-host", "silo-1.dev.opencrane.ai");

		expect(response.status).toBe(200);
		expect(response.body.assets).toEqual([expect.objectContaining({ id: "group-entitled" })]);
		expect(findMany).toHaveBeenCalledTimes(2);
		expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ OR: [{ updatedAt: { lt: secondPageCursor } }, { updatedAt: secondPageCursor, id: { lt: "foreign-1" } }] }) }));
	});
});
