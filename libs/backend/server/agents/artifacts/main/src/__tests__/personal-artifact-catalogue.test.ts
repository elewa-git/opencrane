import { ArtifactIndexState, ArtifactKind, ArtifactState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactCatalogueRepository } from "../prisma-artifact-catalogue-repository";

/** Builds one persisted asset row containing only browser-safe metadata. */
function _artifactRow()
{
	return { id: "asset-1", kind: ArtifactKind.Document, state: ArtifactState.Active, currentRevisionId: "revision-1", currentRevision: { mediaType: "text/plain", byteLength: 12n, indexState: ArtifactIndexState.Indexed }, createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T13:00:00.000Z") };
}

describe("Prisma personal asset catalogue", function _suite()
{
	it("reads non-deleted silo candidates in bounded order before central filtering", async function _listsCandidates()
	{
		const findMany = vi.fn().mockResolvedValue([_artifactRow()]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;

		await expect(new PrismaArtifactCatalogueRepository(prisma).listCatalogueCandidates("silo-1")).resolves.toEqual({ entries: [{ id: "asset-1", kind: "document", state: "active", currentRevisionId: "revision-1", mediaType: "text/plain", byteLength: "12", indexState: "indexed", createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T13:00:00.000Z" }], nextCursor: null });
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", state: { not: ArtifactState.Deleted }, currentRevisionId: { not: null } }, select: { id: true, kind: true, state: true, currentRevisionId: true, currentRevision: { select: { mediaType: true, byteLength: true, indexState: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50 });
	});
});
