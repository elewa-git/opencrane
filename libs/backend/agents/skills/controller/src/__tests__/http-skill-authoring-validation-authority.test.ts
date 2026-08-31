import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { SkillAuthoringValidationRecoveryReasons } from "@opencrane/backend/agents/skills/workflows/contract";

import { __CreateHttpSkillAuthoringValidationControllerAuthority } from "../http-skill-authoring-validation-authority";

/** Returns the saved task receipt the controller presents to every server-owned operation. */
function _Task(): IWorkflowTaskReceipt
{
	return { taskId: "task-1", taskName: "skills.authoring.validate/v1", idempotencyKey: `workflows:skill-authoring-validation:${"a".repeat(64)}` };
}

/** Returns the valid record that gives the handler one fenced validation delivery. */
function _Record(validationId = "validation-1")
{
	return {
		validationId,
		siloId: "silo-1",
		jobId: "job-1",
		claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: "skill-authoring-validation", profileName: "authoring", idempotencyKey: "validation-workload-key", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T10:05:00.000Z", executionReference: "validation-1" },
	};
}

/** Builds an adapter with a rotating token stand-in and one controlled HTTP exchange. */
function _Authority(response: Response)
{
	const fetch = vi.fn().mockResolvedValue(response);
	const authority = __CreateHttpSkillAuthoringValidationControllerAuthority({ openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:8081", serverServiceName: "opencrane-server", serverNamespace: "silo-a", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000, fetch, readToken: async function _ReadToken(): Promise<string> { return "controller-token"; } });
	return { authority, fetch };
}

describe("skill authoring validation HTTP authority", function _DescribeHttpAuthority()
{
	it("rejects an origin outside the configured in-cluster server Service", function _RejectsUntrustedOrigin()
	{
		expect(function _CreateUntrustedAuthority()
		{
			__CreateHttpSkillAuthoringValidationControllerAuthority({ openCraneInternalUrl: "http://attacker.invalid", serverServiceName: "opencrane-server", serverNamespace: "silo-a", tokenPath: "/var/run/opencrane/tokens/opencrane.token", requestTimeoutMilliseconds: 1_000 });
		}).toThrow(/one in-cluster HTTP origin/);
	});

	it("claims only the record returned for the requested validation and durable task", async function _Claims()
	{
		const { authority, fetch } = _Authority(Response.json(_Record()));

		await expect(authority.claimForTask("validation-1", _Task())).resolves.toMatchObject(_Record());
		expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/claim" }), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ get: expect.any(Function) }) }));
		const request = fetch.mock.calls[0]?.[1] as RequestInit;
		expect((request.headers as Headers).get("authorization")).toBe("Bearer controller-token");
		expect(JSON.parse(request.body as string)).toEqual(_Task());
	});

	it("maps a stale server claim to no available validation", async function _RejectsStaleClaim()
	{
		const { authority } = _Authority(Response.json({ error: "stale_or_unavailable_validation" }, { status: 409 }));

		await expect(authority.claimForTask("validation-1", _Task())).resolves.toBeNull();
	});

	it("rejects a response that names another validation", async function _RejectsMismatchedValidation()
	{
		const { authority } = _Authority(Response.json(_Record("validation-other")));

		await expect(authority.claimForTask("validation-1", _Task())).rejects.toThrow(/selected another validation/);
	});

	it("returns a fenced workload bind result only after the response matches", async function _BindsWorkload()
	{
		const { authority, fetch } = _Authority(Response.json({ outcome: "bound", validationId: "validation-1" }));
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };

		await expect(authority.bindWorkload("validation-1", _Task(), { binding, bootstrapReference: "skill-bootstrap-v1_abcdef", namespace: "opencrane-skill-authoring" })).resolves.toBe("bound");
		expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/workload-binding" }), expect.objectContaining({ method: "PUT" }));
	});

	it("returns database-owned workload expiry and recovery-wait outcomes", async function _ReturnsDatabaseClockOutcomes()
	{
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };
		const expired = _Authority(Response.json({ outcome: "expired", validationId: "validation-1" }));
		await expect(expired.authority.bindWorkload("validation-1", _Task(), { binding, bootstrapReference: "skill-bootstrap-v1_abcdef", namespace: "opencrane-skill-authoring" })).resolves.toBe("expired");

		const waiting = _Authority(Response.json({ outcome: "not_expired", validationId: "validation-1" }));
		await expect(waiting.authority.failUnreported("validation-1", _Task(), binding, SkillAuthoringValidationRecoveryReasons.ClaimExpiredWithoutWorker)).resolves.toBe("not_expired");

		const release = _Authority(Response.json({ outcome: "expired", validationId: "validation-1" }));
		await expect(release.authority.authorizeRelease("validation-1", _Task(), binding)).resolves.toBe("expired");
		expect(release.fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/release-authorization" }), expect.objectContaining({ method: "POST" }));
	});

	it("subtracts the measured authorization round trip from the database lifetime", async function _ReservesAuthorizationLatency()
	{
		const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(10_000).mockReturnValue(10_000);
		const release = _Authority(Response.json({ outcome: "authorized", releaseLifetimeSeconds: 25, validationId: "validation-1" }));
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };

		await expect(release.authority.authorizeRelease("validation-1", _Task(), binding)).resolves.toEqual({ outcome: "authorized", releaseLifetimeSeconds: 16 });
		clock.mockRestore();
	});

	it("loads current completion and submits one fixed recovery reason", async function _Recovers()
	{
		const completion = { validationId: "validation-1", completionDigest: `sha256:${"b".repeat(64)}` };
		const current = _Authority(Response.json(completion));
		await expect(current.authority.loadCurrentCompletion("validation-1", _Task())).resolves.toEqual(completion);
		expect(current.fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/completion/current" }), expect.objectContaining({ method: "POST" }));

		const recovered = _Authority(Response.json({ outcome: "failed", validationId: "validation-1" }));
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1", firstPodUid: "pod-uid-1" };
		await expect(recovered.authority.failUnreported("validation-1", _Task(), binding, SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion)).resolves.toBe("failed");
		const request = recovered.fetch.mock.calls[0]?.[1] as RequestInit;
		expect(JSON.parse(request.body as string)).toEqual({ task: _Task(), binding, reason: SkillAuthoringValidationRecoveryReasons.JobTerminalWithoutCompletion });
	});

	it("loads only a validated current lifecycle status for the requested validation", async function _LoadsCurrentStatus()
	{
		const current = _Authority(Response.json({ status: "cancelled", validationId: "validation-1" }));

		await expect(current.authority.loadCurrentStatus("validation-1", _Task())).resolves.toBe("cancelled");
		expect(current.fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/status/current" }), expect.objectContaining({ method: "POST" }));

		const mismatched = _Authority(Response.json({ status: "cancelled", validationId: "validation-other" }));
		await expect(mismatched.authority.loadCurrentStatus("validation-1", _Task())).rejects.toThrow(/another validation/);
	});
});
