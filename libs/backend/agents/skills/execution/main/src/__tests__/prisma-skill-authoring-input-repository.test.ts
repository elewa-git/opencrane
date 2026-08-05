import { describe, expect, it, vi } from "vitest";

import { PrismaSkillAuthoringInputRepository } from "../prisma-skill-authoring-input-repository.js";

/** Exact reviewed worker identity that must match registration and bootstrap consumption. */
const _IDENTITY = { namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", podUid: "pod-uid-1" };
/** Workload projection that binds one reviewed worker to one pinned draft revision. */
const _WORKLOAD = { siloId: "silo-1", workloadUid: "job-uid-1", bootstrap: { workloadUid: "job-uid-1" }, skillRevision: { artifactId: "artifact-1", artifactRevisionId: "revision-1", artifactContentAddress: `sha256:${"a".repeat(64)}` } };
/** Published active artifact projection returned for the pinned draft revision. */
const _REVISION = { artifactId: "artifact-1", id: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 13n, mediaType: "application/gzip" };

/** Builds narrow delegate doubles for the immutable input selection fence. */
function _Repository(workload: unknown, revision: unknown)
{
	const workloadFindFirst = vi.fn().mockResolvedValue(workload);
	const artifactRevisionFindFirst = vi.fn().mockResolvedValue(revision);
	return { repository: new PrismaSkillAuthoringInputRepository({ skillWorkload: { findFirst: workloadFindFirst }, artifactRevision: { findFirst: artifactRevisionFindFirst } } as never), workloadFindFirst, artifactRevisionFindFirst };
}

describe("Prisma skill authoring input authority", function _DescribeAuthoringInput()
{
	it("returns only the fully-pinned active published artifact selected for the reviewed worker", async function _SelectsInput()
	{
		const { repository } = _Repository(_WORKLOAD, _REVISION);

		expect(await repository.load("workload-1", _IDENTITY)).toEqual({ siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 13, mediaType: "application/gzip" });
	});

	it("fails closed when the exact authoring, consumed-bootstrap, active-artifact join finds no row", async function _RejectsForeignOrStaleWorker()
	{
		const { repository, artifactRevisionFindFirst } = _Repository(null, _REVISION);

		expect(await repository.load("workload-1", _IDENTITY)).toBeNull();
		expect(artifactRevisionFindFirst).not.toHaveBeenCalled();
	});

	it("filters the typed workload delegate by the canonical worker Pod", async function _UsesCanonicalWorkerPodColumn()
	{
		const { repository, workloadFindFirst } = _Repository(null, null);

		await repository.load("workload-1", _IDENTITY);
		const query = workloadFindFirst.mock.calls[0]?.[0] as { readonly where?: Record<string, unknown> } | undefined;
		expect(query?.where?.workerPodUid).toBe(_IDENTITY.podUid);
		expect(query?.where).not.toHaveProperty("registeredPodUid");
	});

	it("rejects an artifact length that cannot be represented safely in a signed read lease", async function _RejectsUnsafeLength()
	{
		const { repository } = _Repository(_WORKLOAD, { ..._REVISION, byteLength: BigInt(Number.MAX_SAFE_INTEGER) + 1n });

		expect(await repository.load("workload-1", _IDENTITY)).toBeNull();
	});
});
