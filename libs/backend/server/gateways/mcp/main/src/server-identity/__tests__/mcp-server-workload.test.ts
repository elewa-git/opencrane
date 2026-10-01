import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { MCP_SERVER_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { _CreateMcpServerWorkloadIdentityReader } from "../mcp-server-workload";

vi.mock("node:fs/promises", function _MockFileRead() { return { readFile: vi.fn() }; });

/** Return one deployment-bound reviewer without opening a Kubernetes connection. */
function _Reviewer(podUid = "server-pod")
{
	return { __Review: vi.fn(async function _Review() { return { subject: "system:serviceaccount:server:server-account", namespace: "server", serviceAccountName: "server-account", podUid }; }) };
}

describe("server MCP workload reader", function _WorkloadReader()
{
	beforeEach(function _ResetToken() { vi.mocked(readFile).mockResolvedValue("synthetic-token\n"); });

	it("rereads and verifies the current token before each claim", async function _ReadsCurrentToken()
	{
		const reviewer = _Reviewer();
		const reader = _CreateMcpServerWorkloadIdentityReader({ tokenPath: "/synthetic/token", expectedPodUid: "server-pod", reviewer });
		await expect(reader.read()).resolves.toEqual({ audience: MCP_SERVER_PROJECTED_TOKEN_AUDIENCE, namespace: "server", serviceAccountName: "server-account", workloadKind: "pod", workloadUid: "server-pod", podUid: "server-pod" });
		vi.mocked(readFile).mockResolvedValueOnce("rotated-synthetic-token");
		await reader.read();
		expect(reviewer.__Review.mock.calls).toEqual([["synthetic-token"], ["rotated-synthetic-token"]]);
	});

	it("rejects another Pod even when it has the same configured ServiceAccount", async function _RejectsOtherPod()
	{
		const reader = _CreateMcpServerWorkloadIdentityReader({ tokenPath: "/synthetic/token", expectedPodUid: "server-pod", reviewer: _Reviewer("other-pod") });
		await expect(reader.read()).rejects.toThrow("MCP server workload identity is unavailable");
	});

	it("does not retain Kubernetes errors carrying credentials", async function _HidesUpstreamError()
	{
		const reviewer = { __Review: vi.fn(async function _Fail(): Promise<never> { throw new Error("synthetic-token and upstream request"); }) };
		const reader = _CreateMcpServerWorkloadIdentityReader({ tokenPath: "/synthetic/token", expectedPodUid: "server-pod", reviewer });
		await expect(reader.read()).rejects.toEqual(new Error("MCP server workload identity is unavailable"));
	});
});
