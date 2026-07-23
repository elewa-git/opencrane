import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateArtifactPreprocessorRouter } from "../artifact-preprocessing.router.js";
import type { ArtifactPreprocessorRouterDependencies } from "../artifact-preprocessing.types.js";

/** Builds the private router with a fixed reviewed worker identity and inert authority ports. */
function _App(overrides: Partial<ArtifactPreprocessorRouterDependencies> = {})
{
	const dependencies: ArtifactPreprocessorRouterDependencies = { namespace: "silo-a", tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:artifact-preprocessor", namespace: "silo-a", serviceAccountName: "artifact-preprocessor", audiences: [ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE] }) }, repository: { claimNextAtomically: vi.fn().mockResolvedValue({ status: "none" }), issueOutputLeaseAtomically: vi.fn(), completeAtomically: vi.fn() }, signer: { signReadLease: vi.fn(), signWriteLease: vi.fn() }, receipts: { verifyReceipt: vi.fn(), digestReceipt: vi.fn() }, logger: { error: vi.fn() }, ...overrides };
	const app = express();
	app.use(express.json());
	app.use(__CreateArtifactPreprocessorRouter(dependencies));
	return { app, dependencies };
}

describe("artifact-preprocessor router", function _DescribeRouter()
{
	it("requires the exact reviewed ServiceAccount and audience before a claim", async function _RejectWrongIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:other", namespace: "silo-a", serviceAccountName: "other", audiences: [ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE] }) } });

		const response = await request(app).post("/jobs:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(401);
		expect(dependencies.repository.claimNextAtomically).not.toHaveBeenCalled();
	});

	it("returns a normal empty poll without exposing catalog state", async function _EmptyPoll()
	{
		const { app, dependencies } = _App();

		const response = await request(app).post("/jobs:claim").set("authorization", "Bearer projected-token").send({});

		expect(response.status).toBe(204);
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
	});

	it("rejects extra caller fields on the exact output lease request", async function _RejectExtraOutputField()
	{
		const { app, dependencies } = _App();

		const response = await request(app).put("/jobs/job-1/output-lease").set("authorization", "Bearer projected-token").send({ jobId: "job-1", attempt: 1, claimFence: "fence-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 12, tenantChosenPolicy: true });

		expect(response.status).toBe(400);
		expect(dependencies.repository.issueOutputLeaseAtomically).not.toHaveBeenCalled();
	});
});
