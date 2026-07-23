import { describe, expect, it, vi } from "vitest";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { _CreateRuntimeTokenReviewer } from "../runtime-token-reviewer.js";

/** Build a TokenReview API stub with one controlled Kubernetes response. */
function _ReviewApi(status: object)
{
	return { createTokenReview: vi.fn(async function _review() { return { status }; }) };
}

/** Build a valid runtime TokenReview status, overriding only the assertion under test. */
function _ValidStatus(overrides: object = {})
{
	return {
		authenticated: true,
		audiences: [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE],
		user: {
			username: "system:serviceaccount:runtime-ns:agent-runtime-default",
			extra: { "authentication.kubernetes.io/pod-uid": ["pod-uid-1"] },
		},
		...overrides,
	};
}

describe("runtime projected-token reviewer", function _describeRuntimeTokenReviewer()
{
	it("binds the Kubernetes review to the fixed runtime audience and returns the exact Pod identity", async function _bindsRuntimeIdentity()
	{
		const api = _ReviewApi(_ValidStatus());
		const reviewer = _CreateRuntimeTokenReviewer(api as never, "runtime-ns");

		await expect(reviewer.__Review("projected-token")).resolves.toEqual({
			subject: "system:serviceaccount:runtime-ns:agent-runtime-default",
			namespace: "runtime-ns",
			serviceAccountName: "agent-runtime-default",
			podUid: "pod-uid-1",
		});
		expect(api.createTokenReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ spec: expect.objectContaining({ token: "projected-token", audiences: [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE] }) }) }));
	});

	it.each([
		["an unauthenticated review", _ValidStatus({ authenticated: false })],
		["a review for another audience", _ValidStatus({ audiences: ["another-audience"] })],
		["a subject from another namespace", _ValidStatus({ user: { username: "system:serviceaccount:other:agent-runtime-default", extra: { "authentication.kubernetes.io/pod-uid": ["pod-uid-1"] } } })],
		["a non-runtime ServiceAccount", _ValidStatus({ user: { username: "system:serviceaccount:runtime-ns:other-service", extra: { "authentication.kubernetes.io/pod-uid": ["pod-uid-1"] } } })],
		["a missing bound Pod UID", _ValidStatus({ user: { username: "system:serviceaccount:runtime-ns:agent-runtime-default", extra: {} } })],
	])("rejects %s", async function _rejectsMalformedReview(_description, status)
	{
		const reviewer = _CreateRuntimeTokenReviewer(_ReviewApi(status) as never, "runtime-ns");
		await expect(reviewer.__Review("projected-token")).resolves.toBeNull();
	});
});
