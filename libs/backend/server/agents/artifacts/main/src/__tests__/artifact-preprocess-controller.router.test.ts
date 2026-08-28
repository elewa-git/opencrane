import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { ArtifactPreprocessOutcomeKinds, ArtifactPreprocessTaskNames, type ArtifactPreprocessControllerAuthority, type ArtifactPreprocessOutcome } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateArtifactPreprocessControllerRouter } from "../artifact-preprocess-controller.router";
import type { ArtifactPreprocessControllerRouterDependencies } from "../artifact-preprocess-controller.router.types";

/** Returns the task receipt saved with a published PDF conversion. */
function _Task()
{
	return { taskId: "task-1", taskName: ArtifactPreprocessTaskNames.Convert, idempotencyKey: `workflows:artifact-preprocess:${"a".repeat(64)}` };
}

/** Returns a server-issued controller record for the selected PDF job. */
function _Record()
{
	return { preprocessJobId: "preprocess-1", siloId: "silo-a", claim: { claimId: "claim-1", siloId: "silo-a", workloadClass: "artifact_preprocess", profileName: "pdf-preprocessor", idempotencyKey: "workload-key-1", executionReference: "preprocess-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T10:05:00.000Z" } };
}

/** Returns a Job binding that matches the selected controller delivery. */
function _Binding()
{
	return { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "pdf-preprocessor", workloadUid: "job-uid-1" };
}

/** Builds an internal Express app with a configurable artifact controller authority. */
function _App(overrides: Partial<ArtifactPreprocessControllerRouterDependencies> = {})
{
	const authority: ArtifactPreprocessControllerAuthority = { claimForTask: vi.fn().mockResolvedValue(_Record()), bindWorkload: vi.fn().mockResolvedValue("bound"), bindFirstPod: vi.fn().mockResolvedValue("bound"), loadOutcome: vi.fn(), complete: vi.fn() };
	const dependencies: ArtifactPreprocessControllerRouterDependencies = {
		namespace: "opencrane",
		workerNamespace: "opencrane-artifact-preprocessor",
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:opencrane:agent-controller", namespace: "opencrane", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) },
		authority,
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateArtifactPreprocessControllerRouter(dependencies));
	return { app, dependencies };
}

describe("agent-controller artifact preprocessing router", function _DescribeArtifactControllerRouter()
{
	it("issues a claim only to the reviewed controller identity", async function _Claims()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/artifact-preprocess-jobs/preprocess-1/claim").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.status).toBe(200);
		expect(response.body).toEqual(_Record());
		expect(dependencies.authority.claimForTask).toHaveBeenCalledWith("preprocess-1", _Task());
	});

	it("does not parse or disclose a claim to an unreviewed identity", async function _RejectsUnreviewedIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:opencrane:other", namespace: "opencrane", serviceAccountName: "other", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) } });
		const response = await request(app).post("/artifact-preprocess-jobs/preprocess-1/claim").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.status).toBe(401);
		expect(dependencies.authority.claimForTask).not.toHaveBeenCalled();
	});

	it("forwards a fenced Job binding only in the deployment-owned worker namespace", async function _BindsWorkload()
	{
		const { app, dependencies } = _App();
		const command = { task: _Task(), binding: _Binding(), bootstrapReference: `artifact-preprocess-bootstrap-v1_${"b".repeat(64)}`, namespace: "opencrane-artifact-preprocessor" };
		const response = await request(app).put("/artifact-preprocess-jobs/preprocess-1/workload-binding").set("authorization", "Bearer projected-token").send(command);
		const invalid = await request(app).put("/artifact-preprocess-jobs/preprocess-1/workload-binding").set("authorization", "Bearer projected-token").send({ ...command, namespace: "another-valid-namespace" });
		const malformedReference = await request(app).put("/artifact-preprocess-jobs/preprocess-1/workload-binding").set("authorization", "Bearer projected-token").send({ ...command, bootstrapReference: "not-a-bootstrap-reference" });

		expect(response.status).toBe(200);
		expect(dependencies.authority.bindWorkload).toHaveBeenCalledWith("preprocess-1", _Task(), { binding: _Binding(), bootstrapReference: command.bootstrapReference, namespace: command.namespace });
		expect(invalid.status).toBe(400);
		expect(malformedReference.status).toBe(400);
		expect(dependencies.authority.bindWorkload).toHaveBeenCalledTimes(1);
	});

	it("binds the first Pod only when it carries the original Job delivery fence", async function _BindsFirstPod()
	{
		const { app, dependencies } = _App();
		const binding = { ..._Binding(), firstPodUid: "pod-uid-1" };
		const response = await request(app).put("/artifact-preprocess-jobs/preprocess-1/pod-binding").set("authorization", "Bearer projected-token").send({ task: _Task(), binding });

		expect(response.status).toBe(200);
		expect(dependencies.authority.bindFirstPod).toHaveBeenCalledWith("preprocess-1", _Task(), { binding });
	});

	it("returns only the persisted outcome for the admitted task delivery", async function _LoadsOutcome()
	{
		const outcome: ArtifactPreprocessOutcome = { kind: ArtifactPreprocessOutcomeKinds.RetryableFailed, preprocessJobId: "preprocess-1", deliveryCount: 1, retryAt: "2026-08-25T10:00:30.000Z" };
		const { app, dependencies } = _App();
		vi.mocked(dependencies.authority.loadOutcome).mockResolvedValue(outcome);
		const response = await request(app).post("/artifact-preprocess-jobs/preprocess-1/outcome/load").set("authorization", "Bearer projected-token").send({ task: _Task(), deliveryCount: 1 });

		expect(response.status).toBe(200);
		expect(response.body).toEqual(outcome);
		expect(dependencies.authority.loadOutcome).toHaveBeenCalledWith("preprocess-1", 1, _Task());
	});

	it("logs an unavailable authority operation without the projected bearer token", async function _LogsFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const authority: ArtifactPreprocessControllerAuthority = { claimForTask: vi.fn().mockRejectedValue(failure), bindWorkload: vi.fn(), bindFirstPod: vi.fn(), loadOutcome: vi.fn(), complete: vi.fn() };
		const { app } = _App({ authority, logger });
		const response = await request(app).post("/artifact-preprocess-jobs/preprocess-1/claim").set("authorization", "Bearer secret-projected-token").send(_Task());

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.artifact_preprocess.claim" }, "Artifact preprocessing controller request failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-projected-token");
	});
});
