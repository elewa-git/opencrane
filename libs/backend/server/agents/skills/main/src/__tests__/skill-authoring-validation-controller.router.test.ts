import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { SkillAuthoringValidationRecoveryReasons, SkillAuthoringValidationTaskNames, type SkillAuthoringValidationControllerAuthority } from "@opencrane/backend/agents/skills/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateSkillAuthoringValidationControllerRouter } from "../skill-authoring-validation-controller.router";
import type { SkillAuthoringValidationControllerRouterDependencies } from "../skill-authoring-validation-controller.router.types";

/** Returns the task receipt supplied to the remote workflow handler. */
function _Task()
{
	return { taskId: "task-1", taskName: SkillAuthoringValidationTaskNames.Validate, idempotencyKey: `workflows:skill-authoring-validation:${"a".repeat(64)}` };
}

/** Returns one database-issued validation claim that the controller may bind. */
function _Record()
{
	return {
		validationId: "validation-1",
		siloId: "silo-a",
		jobId: "skill-validation-1",
		claim: { claimId: "claim-1", siloId: "silo-a", workloadClass: RuntimeWorkloadClaimClasses.SkillAuthoringValidation, profileName: "authoring", idempotencyKey: "workload-key-1", executionReference: "validation-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T10:05:00.000Z" },
	};
}

/** Returns one Job binding that matches the controller delivery. */
function _WorkloadBinding()
{
	return { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };
}

/** Builds an internal Express app with a configurable controller authority. */
function _App(overrides: Partial<SkillAuthoringValidationControllerRouterDependencies> = {})
{
	const authority: SkillAuthoringValidationControllerAuthority = { claimForTask: vi.fn().mockResolvedValue(_Record()), failExpiredBeforeWorkload: vi.fn().mockResolvedValue("failed"), bindWorkload: vi.fn().mockResolvedValue("bound"), authorizeRelease: vi.fn().mockResolvedValue({ outcome: "authorized", releaseLifetimeSeconds: 300 }), bindFirstPod: vi.fn().mockResolvedValue("bound"), loadCurrentStatus: vi.fn().mockResolvedValue("active"), loadCurrentCompletion: vi.fn().mockResolvedValue(null), failUnreported: vi.fn().mockResolvedValue("failed"), complete: vi.fn().mockResolvedValue("completed") };
	const dependencies: SkillAuthoringValidationControllerRouterDependencies = {
		namespace: "silo-a",
		authoringNamespace: "opencrane-skill-authoring",
		tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:agent-controller", namespace: "silo-a", serviceAccountName: "agent-controller", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) },
		authority,
		logger: { error: vi.fn() },
		...overrides,
	};
	const app = express();
	app.use(express.json());
	app.use(__CreateSkillAuthoringValidationControllerRouter(dependencies));
	return { app, dependencies };
}

describe("agent-controller skill authoring validation router", function _DescribeRouter()
{
	it("issues a claim only to the reviewed controller identity", async function _Claims()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-authoring-validations/validation-1/claim").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.status).toBe(200);
		expect(response.body).toEqual(_Record());
		expect(dependencies.authority.claimForTask).toHaveBeenCalledWith("validation-1", _Task());
	});

	it("does not disclose a claim to an unreviewed identity", async function _RejectsUnreviewedIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:other", namespace: "silo-a", serviceAccountName: "other", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) } });
		const response = await request(app).post("/skill-authoring-validations/validation-1/claim").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.status).toBe(401);
		expect(dependencies.authority.claimForTask).not.toHaveBeenCalled();
	});

	it("forwards only a fenced Job binding with no caller-selected policy", async function _BindsWorkload()
	{
		const { app, dependencies } = _App();
		const requestBody = { task: _Task(), binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" };
		const response = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send(requestBody);
		const invalid = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send({ ...requestBody, unreviewedPolicy: "widen" });

		expect(response.body).toEqual({ outcome: "bound", validationId: "validation-1" });
		expect(dependencies.authority.bindWorkload).toHaveBeenCalledWith("validation-1", _Task(), { binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" });
		expect(invalid.status).toBe(400);
	});

	it("returns the database-owned expiry outcome without turning it into a transport failure", async function _ReturnsExpiredBind()
	{
		const { app, dependencies } = _App();
		vi.mocked(dependencies.authority.bindWorkload).mockResolvedValue("expired");
		const response = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send({ task: _Task(), binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "expired", validationId: "validation-1" });
	});

	it("checks database time again immediately before the exact Job is released", async function _AuthorizesRelease()
	{
		const { app, dependencies } = _App();
		const response = await request(app).post("/skill-authoring-validations/validation-1/release-authorization").set("authorization", "Bearer projected-token").send({ task: _Task(), binding: _WorkloadBinding() });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "authorized", releaseLifetimeSeconds: 300, validationId: "validation-1" });
		expect(dependencies.authority.authorizeRelease).toHaveBeenCalledWith("validation-1", _Task(), _WorkloadBinding());
	});

	it("binds the first Pod under the original Job delivery", async function _BindsFirstPod()
	{
		const { app, dependencies } = _App();
		const binding = { ..._WorkloadBinding(), firstPodUid: "pod-uid-1" };
		const response = await request(app).put("/skill-authoring-validations/validation-1/pod-binding").set("authorization", "Bearer projected-token").send({ task: _Task(), binding });

		expect(response.status).toBe(200);
		expect(dependencies.authority.bindFirstPod).toHaveBeenCalledWith("validation-1", _Task(), { binding });
	});

	it("forwards only the final server-issued claim for unbound expiry", async function _FailsUnboundExpiry()
	{
		const { app, dependencies } = _App();
		const claim = { ..._Record().claim, deliveryCount: 3 };
		const response = await request(app).post("/skill-authoring-validations/validation-1/failure/unbound-expiry").set("authorization", "Bearer projected-token").send({ task: _Task(), claim });

		expect(response.body).toEqual({ outcome: "failed", validationId: "validation-1" });
		expect(dependencies.authority.failExpiredBeforeWorkload).toHaveBeenCalledWith("validation-1", _Task(), claim);
	});

	it("applies inbox evidence for the same validation", async function _Completes()
	{
		const { app, dependencies } = _App();
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };
		const completed = await request(app).post("/skill-authoring-validations/validation-1/completion/complete").set("authorization", "Bearer projected-token").send({ task: _Task(), completion });

		expect(completed.body).toEqual({ outcome: "completed", validationId: "validation-1" });
		expect(dependencies.authority.complete).toHaveBeenCalledWith("validation-1", completion, _Task());
	});

	it("loads the current completion and saves only a fixed task-owned recovery reason", async function _Recovers()
	{
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };
		const { app, dependencies } = _App();
		vi.mocked(dependencies.authority.loadCurrentCompletion).mockResolvedValue(completion);
		const binding = { ..._WorkloadBinding(), firstPodUid: "pod-uid-1" };

		const loaded = await request(app).post("/skill-authoring-validations/validation-1/completion/current").set("authorization", "Bearer projected-token").send(_Task());
		const failed = await request(app).post("/skill-authoring-validations/validation-1/failure/unreported").set("authorization", "Bearer projected-token").send({ task: _Task(), binding, reason: SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion });
		const invalid = await request(app).post("/skill-authoring-validations/validation-1/failure/unreported").set("authorization", "Bearer projected-token").send({ task: _Task(), binding, reason: "worker_said_so" });

		expect(loaded.body).toEqual(completion);
		expect(failed.body).toEqual({ outcome: "failed", validationId: "validation-1" });
		expect(invalid.status).toBe(400);
		expect(dependencies.authority.failUnreported).toHaveBeenCalledWith("validation-1", _Task(), binding, SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion);
	});

	it("loads the current durable lifecycle status without changing it", async function _LoadsCurrentStatus()
	{
		const { app, dependencies } = _App();
		vi.mocked(dependencies.authority.loadCurrentStatus).mockResolvedValue("cancelled");

		const response = await request(app).post("/skill-authoring-validations/validation-1/status/current").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.body).toEqual({ status: "cancelled", validationId: "validation-1" });
		expect(dependencies.authority.loadCurrentStatus).toHaveBeenCalledWith("validation-1", _Task());
	});

	it("logs authority failures without bearer tokens or request bodies", async function _LogsFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const authority: SkillAuthoringValidationControllerAuthority = { claimForTask: vi.fn().mockRejectedValue(failure), failExpiredBeforeWorkload: vi.fn(), bindWorkload: vi.fn(), authorizeRelease: vi.fn(), bindFirstPod: vi.fn(), loadCurrentStatus: vi.fn(), loadCurrentCompletion: vi.fn(), failUnreported: vi.fn(), complete: vi.fn() };
		const { app } = _App({ authority, logger });
		const response = await request(app).post("/skill-authoring-validations/validation-1/claim").set("authorization", "Bearer secret-projected-token").send(_Task());

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.skill_authoring_validation.claim" }, "Skill authoring validation controller request failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-projected-token");
	});
});
