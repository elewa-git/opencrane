import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { SkillAuthoringValidationTaskNames, type SkillAuthoringValidationControllerAuthority } from "@opencrane/backend/agents/skills/workflows/contract";
import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { __CreateSkillAuthoringValidationControllerRouter } from "../skill-authoring-validation-controller.router";
import type { SkillAuthoringValidationControllerRouterDependencies } from "../skill-authoring-validation-controller.router.types";

/** Returns the immutable task receipt the workflow engine supplied to the remote controller. */
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
		claim: {
			claimId: "claim-1",
			siloId: "silo-a",
			workloadClass: RuntimeWorkloadClaimClasses.SkillAuthoringValidation,
			profileName: "authoring",
			idempotencyKey: "workload-key-1",
			executionReference: "validation-1",
			claimedAt: "2026-08-25T10:00:00.000Z",
			deliveryCount: 1,
			expiresAt: "2026-08-25T10:05:00.000Z",
		},
	};
}

/** Returns one Job binding that matches the supplied controller delivery. */
function _WorkloadBinding()
{
	return { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };
}

/** Builds an internal Express app with a configurable controller authority boundary. */
function _App(overrides: Partial<SkillAuthoringValidationControllerRouterDependencies> = {})
{
	const authority: SkillAuthoringValidationControllerAuthority = {
		claimForTask: vi.fn().mockResolvedValue(_Record()),
		bindWorkload: vi.fn().mockResolvedValue("bound"),
		bindFirstPod: vi.fn().mockResolvedValue("bound"),
		loadCompletion: vi.fn().mockResolvedValue({ validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` }),
		complete: vi.fn().mockResolvedValue("completed"),
	};
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

	it("does not parse or disclose a claim to an unreviewed identity", async function _RejectsUnreviewedIdentity()
	{
		const { app, dependencies } = _App({ tokenReviewer: { __Review: vi.fn().mockResolvedValue({ username: "system:serviceaccount:silo-a:other", namespace: "silo-a", serviceAccountName: "other", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) } });

		const response = await request(app).post("/skill-authoring-validations/validation-1/claim").set("authorization", "Bearer projected-token").send(_Task());

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "controller_identity_denied" });
		expect(dependencies.authority.claimForTask).not.toHaveBeenCalled();
	});

	it("forwards only a fenced Job binding with no caller-selected policy", async function _BindsWorkload()
	{
		const { app, dependencies } = _App();
		const command = { task: _Task(), binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" };

		const response = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send(command);
		const invalid = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send({ ...command, profileName: "attacker-selected" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ outcome: "bound", validationId: "validation-1" });
		expect(dependencies.authority.bindWorkload).toHaveBeenCalledWith("validation-1", _Task(), { binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "opencrane-skill-authoring" });
		expect(invalid.status).toBe(400);
	});

	it("rejects a syntactically valid namespace that the deployed authoring profile did not select", async function _RejectsForeignAuthoringNamespace()
	{
		const { app, dependencies } = _App();
		const command = { task: _Task(), binding: _WorkloadBinding(), bootstrapReference: "skill-bootstrap-v1_opaque-reference", namespace: "another-valid-namespace" };

		const response = await request(app).put("/skill-authoring-validations/validation-1/workload-binding").set("authorization", "Bearer projected-token").send(command);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "invalid_workload_binding" });
		expect(dependencies.authority.bindWorkload).not.toHaveBeenCalled();
	});

	it("binds the first Pod only when it carries the original Job delivery fence", async function _BindsFirstPod()
	{
		const { app, dependencies } = _App();
		const binding = { ..._WorkloadBinding(), firstPodUid: "pod-uid-1" };

		const response = await request(app).put("/skill-authoring-validations/validation-1/pod-binding").set("authorization", "Bearer projected-token").send({ task: _Task(), binding });

		expect(response.status).toBe(200);
		expect(dependencies.authority.bindFirstPod).toHaveBeenCalledWith("validation-1", _Task(), { binding });
	});

	it("loads then completes the server-owned inbox evidence for the same validation", async function _Completes()
	{
		const { app, dependencies } = _App();
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };

		const loaded = await request(app).post("/skill-authoring-validations/validation-1/completion/load").set("authorization", "Bearer projected-token").send({ task: _Task(), completionDigest: completion.completionDigest });
		const completed = await request(app).post("/skill-authoring-validations/validation-1/completion/complete").set("authorization", "Bearer projected-token").send({ task: _Task(), completion });

		expect(loaded.status).toBe(200);
		expect(loaded.body).toEqual(completion);
		expect(completed.status).toBe(200);
		expect(completed.body).toEqual({ outcome: "completed", validationId: "validation-1" });
		expect(dependencies.authority.complete).toHaveBeenCalledWith("validation-1", completion, _Task());
	});

	it("logs authority failures without the projected bearer token or request body", async function _LogsFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const authority: SkillAuthoringValidationControllerAuthority = { claimForTask: vi.fn().mockRejectedValue(failure), bindWorkload: vi.fn(), bindFirstPod: vi.fn(), loadCompletion: vi.fn(), complete: vi.fn() };
		const { app } = _App({ authority, logger });

		const response = await request(app).post("/skill-authoring-validations/validation-1/claim").set("authorization", "Bearer secret-projected-token").send(_Task());

		expect(response.status).toBe(503);
		expect(logger.error).toHaveBeenCalledWith({ err: failure, operation: "agent_controller.skill_authoring_validation.claim" }, "Skill authoring validation controller request failed");
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-projected-token");
	});
});
