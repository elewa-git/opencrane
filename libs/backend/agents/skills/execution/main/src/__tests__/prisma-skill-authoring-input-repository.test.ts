import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthoringInputRepository } from "../prisma-skill-authoring-input-repository.js";

/** Exact reviewed worker identity that must match registration and bootstrap consumption. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };

/** Builds a narrow Prisma raw-query double for the immutable input selection fence. */
function _Prisma(rows: readonly unknown[])
{
	const queryRaw = vi.fn().mockResolvedValue(rows);
	return { repository: new PrismaSkillAuthoringInputRepository({ $queryRaw: queryRaw } as never), queryRaw };
}

describe("Prisma skill authoring input authority", function _DescribeAuthoringInput()
{
	it("returns only the fully-pinned active published artifact selected for the reviewed worker", async function _SelectsInput()
	{
		const { repository } = _Prisma([{ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 13n, mediaType: "application/gzip" }]);

		expect(await repository.load("workload-1", _IDENTITY)).toEqual({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 13, mediaType: "application/gzip" });
	});

	it("fails closed when the exact authoring, consumed-bootstrap, active-artifact join finds no row", async function _RejectsForeignOrStaleWorker()
	{
		const { repository } = _Prisma([]);

		expect(await repository.load("workload-1", _IDENTITY)).toBeNull();
	});

	it("queries the canonical worker Pod fence rather than a legacy registration column", async function _UsesCanonicalWorkerPodColumn()
	{
		const { repository, queryRaw } = _Prisma([]);

		await repository.load("workload-1", _IDENTITY);
		const query = queryRaw.mock.calls[0]?.[0] as { readonly sql?: string } | undefined;
		expect(query?.sql).toContain('workload."worker_pod_uid"');
		expect(query?.sql).not.toContain("registered_pod_uid");
	});

	it("rejects an artifact length that cannot be represented safely in a signed read lease", async function _RejectsUnsafeLength()
	{
		const { repository } = _Prisma([{ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: BigInt(Number.MAX_SAFE_INTEGER) + 1n, mediaType: "application/gzip" }]);

		expect(await repository.load("workload-1", _IDENTITY)).toBeNull();
	});
});
