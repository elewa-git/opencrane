import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { __CreateArtifactPreprocessorRouter } from "../artifact-preprocessing.router.js";
import type { ArtifactPreprocessorRouterDependencies } from "../artifact-preprocessing.types.js";

/** Fixed isolated namespace used by every reviewed test identity. */
const _NAMESPACE = "opencrane-artifact-preprocessing";

/** Build broker-only router dependencies with a successfully reviewed worker identity. */
function _Dependencies(overrides: Partial<ArtifactPreprocessorRouterDependencies> = {}): ArtifactPreprocessorRouterDependencies
{
	return {
		namespace: _NAMESPACE,
		tokenReviewer: {
			__Review: vi.fn().mockResolvedValue({ username: `system:serviceaccount:${_NAMESPACE}:artifact-preprocessor`, namespace: _NAMESPACE, serviceAccountName: "artifact-preprocessor", audiences: ["opencrane-artifact-preprocessor"] }),
		},
		repository: {
			claimNextAtomically: vi.fn().mockResolvedValue({ status: "none" }),
				issueSourceLeaseAtomically: vi.fn(),
			issueOutputLeaseAtomically: vi.fn(),
			completeAtomically: vi.fn(),
			failAtomically: vi.fn().mockResolvedValue({ status: "retryable" }),
		},
		sourceBroker: { read: vi.fn().mockResolvedValue(null) },
		outputBroker: { publish: vi.fn().mockResolvedValue("completed") },
		logger: { error: vi.fn() },
		...overrides,
	};
}

/** Mount the router with the same JSON/raw-body split as the internal server listener. */
function _App(dependencies: ArtifactPreprocessorRouterDependencies)
{
	const app = express();
	app.use("/api/internal/artifact-preprocessor/jobs/:jobId/output", express.raw({ type: "text/plain", limit: 1024 }));
	app.use(express.json());
	app.use("/api/internal/artifact-preprocessor", __CreateArtifactPreprocessorRouter(dependencies));
	return app;
}

/** Standard authorization header carrying a test-only projected token. */
function _Authorization(): { readonly authorization: string }
{
	return { authorization: "Bearer projected-token" };
}

describe("artifact preprocessor broker router", function _Suite()
{
	it("returns only fenced work metadata and no storage capability", async function _Claims()
	{
		const repository = _Dependencies().repository;
		vi.mocked(repository.claimNextAtomically).mockResolvedValue({ status: "claimed", claim: { jobId: "job-1", attempt: 1, claimFence: "fence-1", claimExpiresAt: new Date("2026-07-26T15:00:00.000Z"), siloId: "silo-1", sourceArtifactId: "artifact-1", sourceRevisionId: "revision-1", sourceByteLength: 25 } });
		const response = await request(_App(_Dependencies({ repository }))).post("/api/internal/artifact-preprocessor/jobs:claim").set(_Authorization()).send({});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ lease: { jobId: "job-1", attempt: 1, claimFence: "fence-1", expiresAt: "2026-07-26T15:00:00.000Z" }, sourceMediaType: "application/pdf", sourceByteLength: 25 });
		expect(JSON.stringify(response.body)).not.toMatch(/address|receipt|token|capability|store/iu);
	});

	it("streams source bytes only through the server-side broker", async function _ReadsSource()
	{
		const read = vi.fn().mockResolvedValue({ byteLength: 3, mediaType: "application/pdf", bytes: _Bytes("pdf") });
		const response = await request(_App(_Dependencies({ sourceBroker: { read } }))).post("/api/internal/artifact-preprocessor/jobs/job-1/source").set(_Authorization()).send({ jobId: "job-1", attempt: 2, claimFence: "fence-2" });

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("application/pdf");
		expect(response.body).toEqual(Buffer.from("pdf"));
		expect(read).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence-2" });
	});

	it("submits raw text bytes under private claim headers without receiving a lease", async function _PublishesOutput()
	{
		const publish = vi.fn().mockResolvedValue("completed");
		const response = await request(_App(_Dependencies({ outputBroker: { publish } }))).put("/api/internal/artifact-preprocessor/jobs/job-1/output").set(_Authorization()).set("content-type", "text/plain").set("x-opencrane-preprocess-attempt", "2").set("x-opencrane-preprocess-fence", "fence-2").send("derived text");

		expect(response.status).toBe(204);
		expect(publish).toHaveBeenCalledWith({ jobId: "job-1", attempt: 2, claimFence: "fence-2" }, expect.anything());
		const submitted = await _Collect(vi.mocked(publish).mock.calls[0]?.[1]);
		expect(submitted.toString("utf8")).toBe("derived text");
	});

	it("fails closed when TokenReview does not return the exact worker identity", async function _RejectsIdentity()
	{
		const tokenReviewer = { __Review: vi.fn().mockResolvedValue(null) };
		const response = await request(_App(_Dependencies({ tokenReviewer }))).post("/api/internal/artifact-preprocessor/jobs:claim").set(_Authorization()).send({});
		expect(response.status).toBe(401);
	});
});

/** Yield one UTF-8 test body through the broker stream contract. */
async function* _Bytes(value: string): AsyncGenerator<Uint8Array>
{
	yield Buffer.from(value);
}

/** Collect one test-only submitted stream so its exact bytes can be asserted. */
async function _Collect(bytes: AsyncIterable<Uint8Array> | undefined): Promise<Buffer>
{
	if (bytes === undefined) throw new Error("missing submitted bytes");
	const chunks: Buffer[] = [];
	for await (const chunk of bytes) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}
