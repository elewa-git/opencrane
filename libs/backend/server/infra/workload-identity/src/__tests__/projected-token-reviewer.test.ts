import { describe, expect, it, vi } from "vitest";

import { AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";

import { _CreateAgentControllerTokenReviewer, _CreateArtifactPreprocessorTokenReviewer, _CreateArtifactScannerTokenReviewer, _CreateChannelProxyTokenReviewer, _CreateMcpExecutorTokenReviewer, _CreateMemoryGatewayServerTokenReviewer, _CreateRuntimeTokenReviewer, _CreateSkillWorkloadTokenReviewer, _ValidateIsolatedWorkloadNamespace, _ValidateRuntimeIdentityNamespaces } from "../projected-token-reviewer";

/** Build a TokenReview API stub with one controlled Kubernetes response. */
function _ReviewApi(status: object)
{
	return { createTokenReview: vi.fn(async function _review() { return { status }; }) };
}

/** Build one authenticated, audience-bound Kubernetes review status. */
function _ValidStatus(audience: string, username: string, overrides: object = {})
{
	return {
		authenticated: true,
		audiences: [audience],
		user: { username, extra: { "authentication.kubernetes.io/pod-uid": ["pod-uid-1"] } },
		...overrides,
	};
}

describe("projected Kubernetes workload identity", function _describeProjectedIdentity()
{
	it("rejects overlapping trusted and untrusted workload namespaces", function _rejectsNamespaceOverlap()
	{
		expect(function _validate() { return _ValidateRuntimeIdentityNamespaces({ serverNamespace: "server", personalRuntimeNamespace: "runtime", managedRuntimeNamespace: "runtime" }); }).toThrow(/must be valid, distinct/);
		expect(function _validate() { return _ValidateIsolatedWorkloadNamespace("server", "server"); }).toThrow(/different from POD_NAMESPACE/);
	});

	it("binds the agent controller to its fixed audience, namespace, and ServiceAccount", async function _reviewsController()
	{
		const username = `system:serviceaccount:server-ns:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`;
		const api = _ReviewApi(_ValidStatus(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, username));
		const reviewer = _CreateAgentControllerTokenReviewer(api as never, "server-ns");

		await expect(reviewer.__Review("token")).resolves.toEqual({ username, namespace: "server-ns", serviceAccountName: AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME, audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] });
		expect(api.createTokenReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ spec: expect.objectContaining({ token: "token", audiences: [AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE] }) }) }));
	});

	it("binds the artifact preprocessor to its dedicated namespace", async function _reviewsPreprocessor()
	{
		const username = `system:serviceaccount:preprocess-ns:${ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME}`;
		const reviewer = _CreateArtifactPreprocessorTokenReviewer(_ReviewApi(_ValidStatus(ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE, username)) as never, "preprocess-ns");
		await expect(reviewer.__Review("token")).resolves.toEqual({ username, namespace: "preprocess-ns", serviceAccountName: ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME, audiences: [ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE] });
	});

	it("binds the MCP executor companion to its audience, account, namespace, and Pod UID", async function _ReviewsMcpExecutor()
	{
		const audience = "opencrane-mcp-executor";
		const subject = "system:serviceaccount:mcp-executor:mcp-executor-default";
		const reviewer = _CreateMcpExecutorTokenReviewer(_ReviewApi(_ValidStatus(audience, subject)) as never, "mcp-executor");

		await expect(reviewer.__Review("token")).resolves.toEqual({ subject, namespace: "mcp-executor", serviceAccountName: "mcp-executor-default", podUid: "pod-uid-1" });
	});

	it.each([
		["wrong audience", _ValidStatus("other", "system:serviceaccount:mcp-executor:mcp-executor-default")],
		["wrong namespace", _ValidStatus("opencrane-mcp-executor", "system:serviceaccount:other:mcp-executor-default")],
		["wrong account", _ValidStatus("opencrane-mcp-executor", "system:serviceaccount:mcp-executor:other")],
		["missing Pod UID", _ValidStatus("opencrane-mcp-executor", "system:serviceaccount:mcp-executor:mcp-executor-default", { user: { username: "system:serviceaccount:mcp-executor:mcp-executor-default", extra: {} } })],
	])("rejects an MCP executor with %s", async function _RejectsMcpExecutor(_description, status)
	{
		const reviewer = _CreateMcpExecutorTokenReviewer(_ReviewApi(status) as never, "mcp-executor");
		await expect(reviewer.__Review("token")).resolves.toBeNull();
	});

	it("binds the artifact scanner to its dedicated audience and namespace", async function _reviewsScanner()
	{
		const username = `system:serviceaccount:scanner-ns:${ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME}`;
		const reviewer = _CreateArtifactScannerTokenReviewer(_ReviewApi(_ValidStatus(ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE, username)) as never, "scanner-ns");

		await expect(reviewer.__Review("token")).resolves.toEqual({ username, namespace: "scanner-ns", serviceAccountName: ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME, audiences: [ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE] });
	});

	it("binds channel-proxy to one deployment-fixed audience and subject", async function _ReviewsChannelProxy()
	{
		const username = "system:serviceaccount:silo-ns:channel-proxy";
		const api = _ReviewApi(_ValidStatus("opencrane", username));
		const reviewer = _CreateChannelProxyTokenReviewer(api as never, { audience: "opencrane", namespace: "silo-ns", serviceAccountName: "channel-proxy" });

		await expect(reviewer.__Review("token")).resolves.toEqual({ username, namespace: "silo-ns", serviceAccountName: "channel-proxy", audiences: ["opencrane"] });
		expect(api.createTokenReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ spec: expect.objectContaining({ audiences: ["opencrane"], token: "token" }) }) }));
	});

	it("rejects channel-proxy identity drift without exposing the review", async function _RejectsChannelProxyDrift()
	{
		const reviewer = _CreateChannelProxyTokenReviewer(_ReviewApi(_ValidStatus("opencrane", "system:serviceaccount:other:channel-proxy")) as never, { audience: "opencrane", namespace: "silo-ns", serviceAccountName: "channel-proxy" });

		await expect(reviewer.__Review("token")).resolves.toBeNull();
	});

	it("binds memory-gateway to its deployment-fixed server identity", async function _reviewsMemoryGatewayServer()
	{
		const username = "system:serviceaccount:server-ns:opencrane-server";
		const api = _ReviewApi(_ValidStatus("opencrane-memory-gateway", username));
		const reviewer = _CreateMemoryGatewayServerTokenReviewer(api as never, { audience: "opencrane-memory-gateway", namespace: "server-ns", serviceAccountName: "opencrane-server" });
		await expect(reviewer.__Review("token")).resolves.toEqual({ username, namespace: "server-ns", serviceAccountName: "opencrane-server", audiences: ["opencrane-memory-gateway"] });
	});

	it("parses a skill worker only with a bound Pod UID and server-selected audience", async function _reviewsSkillWorker()
	{
		const reviewer = _CreateSkillWorkloadTokenReviewer(_ReviewApi(_ValidStatus("skill-audience", "system:serviceaccount:skills-ns:skill-authoring-1")) as never);
		await expect(reviewer.__Review("token", "skill-audience")).resolves.toEqual({ namespace: "skills-ns", serviceAccountName: "skill-authoring-1", podUid: "pod-uid-1" });
	});

	it("binds personal and managed runtimes to distinct namespace and account grammars", async function _reviewsRuntimeClasses()
	{
		const config = { personalRuntimeNamespace: "runtime-ns", managedRuntimeNamespace: "managed-ns" };
		const personal = _CreateRuntimeTokenReviewer(_ReviewApi(_ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:runtime-ns:agent-runtime-default")) as never, config);
		const managed = _CreateRuntimeTokenReviewer(_ReviewApi(_ValidStatus(MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:managed-ns:managed-agent-runtime-default")) as never, config);

		await expect(personal.__Review("token")).resolves.toEqual({ subject: "system:serviceaccount:runtime-ns:agent-runtime-default", namespace: "runtime-ns", serviceAccountName: "agent-runtime-default", podUid: "pod-uid-1" });
		await expect(managed.__Review("token")).resolves.toEqual({ subject: "system:serviceaccount:managed-ns:managed-agent-runtime-default", namespace: "managed-ns", serviceAccountName: "managed-agent-runtime-default", podUid: "pod-uid-1" });
	});

	it.each([
		["unauthenticated", _ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:runtime-ns:agent-runtime-default", { authenticated: false })],
		["wrong namespace", _ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:other:agent-runtime-default")],
		["wrong account grammar", _ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:runtime-ns:other")],
		["missing Pod UID", _ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:runtime-ns:agent-runtime-default", { user: { username: "system:serviceaccount:runtime-ns:agent-runtime-default", extra: {} } })],
		["ambiguous audience", _ValidStatus(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, "system:serviceaccount:runtime-ns:agent-runtime-default", { audiences: [AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE] })],
	])("rejects a %s runtime review", async function _rejectsRuntime(_description, status)
	{
		const reviewer = _CreateRuntimeTokenReviewer(_ReviewApi(status) as never, { personalRuntimeNamespace: "runtime-ns", managedRuntimeNamespace: "managed-ns" });
		await expect(reviewer.__Review("token")).resolves.toBeNull();
	});

	it("rejects a fixed reviewer subject from another namespace", async function _rejectsFixedSubject()
	{
		const username = `system:serviceaccount:other:${AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME}`;
		const reviewer = _CreateAgentControllerTokenReviewer(_ReviewApi(_ValidStatus(AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE, username)) as never, "server-ns");
		await expect(reviewer.__Review("token")).resolves.toBeNull();
	});
});
