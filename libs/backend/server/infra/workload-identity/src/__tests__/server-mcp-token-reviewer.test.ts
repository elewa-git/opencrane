import { describe, expect, it, vi } from "vitest";
import { MCP_SERVER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { _CreateMcpServerTokenReviewer } from "../reviewers/server-mcp-token-reviewer";

/** Build controlled Kubernetes proof independently of any caller-provided identity. */
function _Status(overrides: object = {})
{
	return { authenticated: true, audiences: [MCP_SERVER_PROJECTED_TOKEN_AUDIENCE], user: { username: "system:serviceaccount:server-ns:opencrane-server", extra: { "authentication.kubernetes.io/pod-uid": ["server-pod"] } }, ...overrides };
}

describe("MCP server workload identity", function _ServerIdentity()
{
	it("requires the dedicated audience and returns the bound server Pod", async function _AcceptsExactServer()
	{
		const api = { createTokenReview: vi.fn(async function _Review() { return { status: _Status() }; }) };
		const reviewer = _CreateMcpServerTokenReviewer(api as never, "server-ns", "opencrane-server");
		await expect(reviewer.__Review("synthetic-token")).resolves.toEqual({ subject: "system:serviceaccount:server-ns:opencrane-server", namespace: "server-ns", serviceAccountName: "opencrane-server", podUid: "server-pod" });
		expect(api.createTokenReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ spec: { token: "synthetic-token", audiences: [MCP_SERVER_PROJECTED_TOKEN_AUDIENCE] } }) }));
	});

	it.each([
		_Status({ authenticated: false }),
		_Status({ audiences: ["opencrane-mcp-executor"] }),
		_Status({ user: { username: "system:serviceaccount:other:opencrane-server", extra: { "authentication.kubernetes.io/pod-uid": ["server-pod"] } } }),
		_Status({ user: { username: "system:serviceaccount:server-ns:other", extra: { "authentication.kubernetes.io/pod-uid": ["server-pod"] } } }),
		_Status({ user: { username: "system:serviceaccount:server-ns:opencrane-server", extra: {} } }),
	])("rejects incomplete or foreign Kubernetes proof %#", async function _RejectsForeignProof(status)
	{
		const api = { createTokenReview: vi.fn(async function _Review() { return { status }; }) };
		await expect(_CreateMcpServerTokenReviewer(api as never, "server-ns", "opencrane-server").__Review("synthetic-token")).resolves.toBeNull();
	});
});
