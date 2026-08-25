import { describe, expect, it, vi } from "vitest";

import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateHttpSkillAuthoringValidationControllerAuthority } from "../http-skill-authoring-validation-authority";

/** Returns the saved task receipt the controller presents to every server-owned operation. */
function _Task(): IWorkflowTaskReceipt
{
	return { taskId: "task-1", taskName: "skills.authoring.validate/v1", idempotencyKey: `workflows:skill-authoring-validation:${"a".repeat(64)}` };
}

/** Returns the valid record that gives the durable handler one fenced validation delivery. */
function _Record(validationId = "validation-1")
{
	return {
		validationId,
		siloId: "silo-1",
		jobId: "job-1",
		claim: {
			claimId: "claim-1",
			siloId: "silo-1",
			workloadClass: "skill-authoring-validation",
			profileName: "authoring",
			idempotencyKey: "validation-workload-key",
			claimedAt: "2026-08-25T10:00:00.000Z",
			deliveryCount: 1,
			expiresAt: "2026-08-25T10:05:00.000Z",
			executionReference: "validation-1",
		},
	};
}

/** Builds an adapter with a rotating token stand-in and one controlled HTTP exchange. */
function _Authority(response: Response)
{
	const fetch = vi.fn().mockResolvedValue(response);
	const authority = __CreateHttpSkillAuthoringValidationControllerAuthority({
		openCraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:8081",
		tokenPath: "/var/run/opencrane/tokens/opencrane.token",
		requestTimeoutMilliseconds: 1_000,
		fetch,
		readToken: async function _ReadToken(): Promise<string> { return "controller-token"; },
	});
	return { authority, fetch };
}

describe("skill authoring validation HTTP authority", function _DescribeHttpSkillAuthoringValidationAuthority()
{
	it("claims only the record returned for the requested validation and durable task", async function _Claims()
	{
		const { authority, fetch } = _Authority(Response.json(_Record()));

		await expect(authority.claimForTask("validation-1", _Task())).resolves.toMatchObject(_Record());

		expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/claim" }), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ get: expect.any(Function) }) }));
		const request = fetch.mock.calls[0]?.[1] as RequestInit;
		expect(request.headers).toBeInstanceOf(Headers);
		expect((request.headers as Headers).get("authorization")).toBe("Bearer controller-token");
		expect(JSON.parse(request.body as string)).toEqual(_Task());
	});

	it("turns a stale server claim into no available validation", async function _RejectsStaleClaim()
	{
		const { authority } = _Authority(Response.json({ error: "stale_or_unavailable_validation" }, { status: 409 }));

		await expect(authority.claimForTask("validation-1", _Task())).resolves.toBeNull();
	});

	it("rejects a response that names another validation before it can reach the handler", async function _RejectsMismatchedValidation()
	{
		const { authority } = _Authority(Response.json(_Record("validation-other")));

		await expect(authority.claimForTask("validation-1", _Task())).rejects.toThrow(/selected another validation/);
	});

	it("returns a fenced workload bind result only after the server response matches the request", async function _BindsWorkload()
	{
		const { authority, fetch } = _Authority(Response.json({ outcome: "bound", validationId: "validation-1" }));
		const binding = { claimId: "claim-1", claimedAt: "2026-08-25T10:00:00.000Z", deliveryCount: 1, profileName: "authoring", workloadUid: "job-uid-1" };

		await expect(authority.bindWorkload("validation-1", _Task(), { binding, bootstrapReference: "skill-bootstrap-v1_abcdef", namespace: "opencrane-skill-authoring" })).resolves.toBe("bound");

		expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/api/internal/agent-controller/skill-authoring-validations/validation-1/workload-binding" }), expect.objectContaining({ method: "PUT" }));
	});
});
