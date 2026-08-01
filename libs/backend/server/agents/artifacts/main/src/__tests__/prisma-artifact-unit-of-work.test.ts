import { describe, expect, it, vi } from "vitest";

import { PrismaArtifactPreprocessUnitOfWork } from "../prisma-artifact-preprocess-unit-of-work.js";
import { PrismaArtifactPublicationUnitOfWork } from "../prisma-artifact-publication-unit-of-work.js";

/** Builds the minimum transaction delegates needed to construct both scoped artifact repositories. */
function _Transaction()
{
	return { $queryRaw: vi.fn(), $executeRaw: vi.fn(), artifact: {}, artifactRevision: {}, artifactUploadLease: {}, artifactOutboxEvent: {}, artifactPreprocessJob: {}, artifactRevisionParent: {} };
}

/** Builds a Prisma-client double that exposes one transaction callback boundary. */
function _Prisma(transaction: ReturnType<typeof _Transaction>)
{
	return { $transaction: vi.fn(async function _Transaction(work: (client: typeof transaction) => Promise<unknown>): Promise<unknown> { return work(transaction); }) };
}

/** Proves artifact authority transaction ownership remains opaque to application callers. */
describe("Prisma artifact units of work", function _Suite()
{
	it("binds publication lease and finalization repositories to the same private transaction", async function _BindsPublicationRepositories()
	{
		const transaction = _Transaction();
		const prisma = _Prisma(transaction);
		const result = await new PrismaArtifactPublicationUnitOfWork(prisma as never).run(async function _Observe(repositories)
		{
			return Object.is(repositories.revisions, repositories.uploadLeases);
		});

		expect(result).toBe(true);
		expect(prisma.$transaction).toHaveBeenCalledOnce();
	});

	it("constructs a preprocessing repository only inside the private transaction callback", async function _BindsPreprocessRepository()
	{
		const transaction = _Transaction();
		const prisma = _Prisma(transaction);
		const result = await new PrismaArtifactPreprocessUnitOfWork(prisma as never).run(async function _Observe(repository)
		{
			return repository !== null;
		});

		expect(result).toBe(true);
		expect(prisma.$transaction).toHaveBeenCalledOnce();
	});
});
