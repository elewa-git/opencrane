import { ArtifactIndexState, ArtifactKind, ArtifactState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactAuthorityRepository } from "../prisma-artifact-authority.js";

/** Builds one persisted asset row containing only browser-safe metadata. */
function _artifactRow()
{
	return { id: "asset-1", kind: ArtifactKind.Document, state: ArtifactState.Active, currentRevisionId: "revision-1", currentRevision: { mediaType: "text/plain", byteLength: 12n, indexState: ArtifactIndexState.Indexed }, createdAt: new Date("2026-07-26T12:00:00.000Z"), updatedAt: new Date("2026-07-26T13:00:00.000Z") };
}

describe("Prisma personal asset catalogue", function _suite()
{
	it("reads non-deleted assets only from the exact owner and silo in bounded order", async function _listsOwnedAssets()
	{
		const findMany = vi.fn().mockResolvedValue([_artifactRow()]);
		const prisma = { artifact: { findMany } } as unknown as PrismaClient;

		await expect(new PrismaArtifactAuthorityRepository(prisma).listOwnedCatalogue("silo-1", "user-1")).resolves.toEqual([{ id: "asset-1", kind: "document", state: "active", currentRevisionId: "revision-1", mediaType: "text/plain", byteLength: "12", indexState: "indexed", createdAt: "2026-07-26T12:00:00.000Z", updatedAt: "2026-07-26T13:00:00.000Z" }]);
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", ownerPrincipalId: "user-1", state: { not: ArtifactState.Deleted }, currentRevisionId: { not: null } }, select: { id: true, kind: true, state: true, currentRevisionId: true, currentRevision: { select: { mediaType: true, byteLength: true, indexState: true } }, createdAt: true, updatedAt: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 50 });
	});
});
