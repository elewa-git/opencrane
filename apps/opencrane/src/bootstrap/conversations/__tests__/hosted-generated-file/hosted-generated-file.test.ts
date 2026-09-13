import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { __HostedGeneratedFileAssignCommand } from "./hosted-generated-file-assign-grant";
import { HostedGeneratedFilePublicClient } from "./hosted-generated-file-client";
import { __HostedGeneratedFileConfig } from "./hosted-generated-file-cli";
import { __AssertHostedDownload, __AssertHostedOciContinuity, __HostedGeneratedFileDigest } from "./hosted-generated-file-evidence";
import { __AssertHostedToolSelection, _ReadTerminalProjection } from "./hosted-generated-file-journey";
import { __HostedGeneratedFilePrincipalId } from "./hosted-generated-file-prerequisite-builder";
import { __LoadHostedGeneratedFilePrerequisites } from "./hosted-generated-file-prerequisites";
import { __HostedAsset, __HostedRun, __HostedToolSelection, __HostedValidation } from "./hosted-generated-file-response";
import { __CreateHostedGeneratedFileFetch } from "./hosted-generated-file-transport";
import type { HostedGeneratedFileFetch } from "./hosted-generated-file.types";

const _TemporaryDirectories: string[] = [];

afterEach(async function _Cleanup()
{
	await Promise.all(_TemporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("hosted generated-file public client", function _PublicClientSuite()
{
	it("completes the real redirect shape while rewriting only the provider authorization transport", async function _Login()
	{
		const calls: { readonly url: string; readonly init: RequestInit }[] = [];
		const responses = [
			_Response(302, null, { location: "https://host.k3d.internal:9443/authorize?client_id=opencrane&state=state-1", "set-cookie": "sid=flow; Path=/; HttpOnly" }),
			_Response(302, null, { location: "https://smoke.opencrane.test:8443/api/v1/auth/callback?code=code-1&state=state-1" }),
			_Response(302, null, { location: "/", "set-cookie": "sid=authenticated; Path=/; HttpOnly" }),
			_Response(200, { mode: "oidc", authenticated: true, user: { sub: "subject-1", email: "owner@smoke.test" } }),
		];
		const fetch = vi.fn<HostedGeneratedFileFetch>(async function _Fetch(input, init = {})
		{
			calls.push({ url: String(input), init });
			const response = responses.shift();
			if (response === undefined)
				throw new Error("unexpected request");
			return response;
		});
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), new URL("https://127.0.0.1:9443"), fetch);

		await client.login({ subject: "subject-1", email: "owner@smoke.test" });

		expect(calls.map(call => new URL(call.url).origin)).toEqual([
			"https://smoke.opencrane.test:8443",
			"https://127.0.0.1:9443",
			"https://smoke.opencrane.test:8443",
			"https://smoke.opencrane.test:8443",
		]);
		expect(new URL(calls[1]!.url).searchParams.get("login_hint")).toBe("owner@smoke.test");
		expect(new Headers(calls[2]!.init.headers).get("cookie")).toBe("sid=flow");
		expect(new Headers(calls[3]!.init.headers).get("cookie")).toBe("sid=authenticated");
	});

	it("cancels a nonresponding OIDC authorization request at the configured deadline", async function _OidcTimeout()
	{
		const authorizationSignals: AbortSignal[] = [];
		let calls = 0;
		const fetch = vi.fn<HostedGeneratedFileFetch>(async function _Fetch(_input, init = {})
		{
			calls += 1;
			if (calls === 1)
				return _Response(302, null, { location: "https://issuer.test/authorize?state=state-1" });
			const authorizationSignal = init.signal;
			if (authorizationSignal === undefined || authorizationSignal === null)
				throw new Error("OIDC request omitted its deadline signal");
			authorizationSignals.push(authorizationSignal);
			return new Promise(function _NeverRespond(_resolve, reject)
			{
				authorizationSignal.addEventListener("abort", function _Abort() { reject(new Error("OIDC request aborted")); }, { once: true });
			});
		});
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), null, fetch, 30);

		await expect(client.login()).rejects.toThrow("OIDC request aborted");
		expect(authorizationSignals).toHaveLength(1);
		expect(authorizationSignals[0]!.aborted).toBe(true);
	});

	it("cancels and releases a nonresponding loopback HTTPS socket", async function _SocketTimeout()
	{
		const sockets = new Set<Socket>();
		const server = createServer(function _Connection(socket)
		{
			sockets.add(socket);
			socket.once("close", function _Closed() { sockets.delete(socket); });
			socket.resume();
		});
		const port = await _Listen(server);
		const baseUrl = new URL(`https://smoke.opencrane.test:${port}`);
		const client = new HostedGeneratedFilePublicClient(baseUrl, null, __CreateHostedGeneratedFileFetch(baseUrl, "127.0.0.1"), 40);
		try
		{
			await expect(client.history("conversation-1")).rejects.toThrow(/aborted/i);
			await vi.waitFor(function _Released() { expect(sockets.size).toBe(0); }, { timeout: 500, interval: 10 });
			await _Close(server);
		}
		finally
		{
			for (const socket of sockets)
				socket.destroy();
			if (server.listening)
				await _Close(server);
		}
	});

	it("closes setup mutations after activation and permits only the exact replay", async function _AdmissionBoundary()
	{
		const requests: { readonly body: string | null; readonly path: string }[] = [];
		const responses = [
			_Response(201, { conversation: { id: "conversation-1" } }),
			_Response(202, { outcome: "accepted", position: "1" }),
			_Response(200, { outcome: "idempotent", position: "1" }),
		];
		const fetch = vi.fn<HostedGeneratedFileFetch>(async function _Fetch(input, init = {})
		{
			requests.push({ body: typeof init.body === "string" ? init.body : null, path: new URL(String(input)).pathname });
			const response = responses.shift();
			if (response === undefined)
				throw new Error("unexpected request");
			return response;
		});
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), null, fetch);
		await expect(client.createConversation("personal-agent-1")).resolves.toBe("conversation-1");
		await expect(client.activate("conversation-1", "Create the CSV.")).resolves.toMatchObject({ outcome: "accepted", position: "1", idempotencyKey: expect.any(String) });

		await expect(client.createConversation("personal-agent-1")).rejects.toThrow("after activation admission");
		await expect(client.publishAndInstallServer("server-1")).rejects.toThrow("after activation admission");
		await expect(client.replayActivation()).resolves.toEqual({ outcome: "idempotent", position: "1" });
		expect(requests[1]!.body).toBe(requests[2]!.body);
		expect(requests.map(request => request.path)).toEqual([
			"/api/v1/me/conversations",
			"/api/v1/me/conversations/conversation-1/messages",
			"/api/v1/me/conversations/conversation-1/messages",
		]);
	});

	it("sends only the active revision and one discovered tool to personal selection", async function _StrictSelectionBody()
	{
		const requests: RequestInit[] = [];
		const fetch = vi.fn<HostedGeneratedFileFetch>(async function _Fetch(_input, init = {})
		{
			requests.push(init);
			return _Response(200, { agentServiceId: "agent-1", activeRevisionId: "revision-2", toolRevisionIds: ["tool-1"] });
		});
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), null, fetch);
		await client.selectPersonalTool("revision-1", "tool-1");
		expect(JSON.parse(String(requests[0]!.body))).toEqual({ expectedActiveRevisionId: "revision-1", toolRevisionIds: ["tool-1"] });
		expect(JSON.parse(String(requests[0]!.body))).not.toHaveProperty("personalAgentRef");
		const stale = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), null, vi.fn<HostedGeneratedFileFetch>(async function _Conflict() { return _Response(409, { error: "personal_agent_revision_changed" }); }));
		await expect(stale.selectPersonalTool("revision-stale", "tool-1")).rejects.toThrow("returned 409");
	});

	it("creates and accepts only the exact public Admin invitation", async function _Invitation()
	{
		const calls: RequestInit[] = [];
		const responses = [_Response(201, { createdCount: 1, invitations: [{ inviteLink: "https://smoke.opencrane.test/invite?token=abcdefghijklmnopqrstuvwxyz0123456789" }] }), _Response(200, { member: { membershipId: "member-b", role: "admin", status: "active", isCurrentUser: true } })];
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test:8443"), null, vi.fn<HostedGeneratedFileFetch>(async function _Fetch(_input, init = {}) { calls.push(init); return responses.shift()!; }));
		const token = await client.inviteAdministrator("requester@smoke.test");
		await client.acceptInvitation(token);
		expect(JSON.parse(String(calls[0]!.body))).toEqual({ emails: ["requester@smoke.test"], role: "admin" });
		expect(new Headers(calls[0]!.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
		expect(JSON.parse(String(calls[1]!.body))).toEqual({ token });
	});

	it("requires every revoked read to fail at the exact membership gate", async function _MembershipDenial()
	{
		const paths: string[] = [];
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test"), null, vi.fn<HostedGeneratedFileFetch>(async function _Denied(input)
		{
			paths.push(new URL(String(input)).pathname);
			return _Response(403, { code: "MEMBERSHIP_REQUIRED", error: "Active membership is required." });
		}));
		await client.assertMembershipDenied(["/api/v1/me/conversations/conversation-1/history", "/api/v1/me/conversations/conversation-1/assets", "/api/v1/me/runs", "/api/v1/me/runs/run-1"]);
		await client.assertDownloadDenied("conversation-1", "asset-1");
		expect(paths).toEqual(["/api/v1/me/conversations/conversation-1/history", "/api/v1/me/conversations/conversation-1/assets", "/api/v1/me/runs", "/api/v1/me/runs/run-1", "/api/v1/me/conversations/conversation-1/assets/asset-1/content"]);

		const unauthorized = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test"), null, vi.fn<HostedGeneratedFileFetch>(async function _Unauthorized() { return _Response(401, { code: "AUTHENTICATION_REQUIRED" }); }));
		await expect(unauthorized.assertMembershipDenied(["/api/v1/me/runs"])).rejects.toThrow("returned 401");
	});

	it("uses the public model, persona, and three-answer onboarding owners in order", async function _PublicPrerequisiteOrder()
	{
		const calls: { readonly url: URL; readonly body: unknown }[] = [];
		const responses = [
			_Response(503, { code: "PROVIDER_EFFECT_PENDING", commandId: "provider-command-1" }),
			_Response(200, { provider: "openai", configured: true, litellmRegistered: true, updatedAt: "2026-09-13T00:00:00Z" }),
			_Response(200, [{ id: "catalogue-model-1", publicModelName: "openai/gpt-5.5", providerCredentialId: "byok:tenant-a:openai" }]),
			_Response(503, { code: "PROVIDER_EFFECT_PENDING", commandId: "model-command-1", modelDefinitionId: "model-1" }),
			_Response(200, { id: "model-1", scope: "clusterTenant", clusterTenant: "tenant-a", publicModelName: "hosted-generated-file-model", upstreamModel: "openai/hosted-generated-file", apiBase: "http://hosted-generated-file-protocol.hosted-file-smoke.svc:4000/v1", providerCredentialId: "byok:tenant-a:openai", generatedOutputCapabilities: ["code_execution_files"] }),
			_Response(200, { scope: "clusterTenant", clusterTenant: "tenant-a", defaultModel: "hosted-generated-file-model" }),
			_Response(200, { state: "interview" }),
			_Response(200, { interviewId: "interview-1", questions: [{ id: "question-1", choices: [{ id: "choice-1" }] }] }),
			_Response(201, { answerId: "answer-1" }), _Response(200, { state: "completed", resolution: null }),
			_Response(201, { personaRevisionId: "persona-1", state: "draft" }), _Response(200, { personaRevisionId: "persona-1", state: "approved" }),
			_Response(200, { state: "bootstrap_chat_pending" }),
			_Response(200, _Chat(0, 1)), _Response(201, _Chat(1, 2)), _Response(201, _Chat(2, 3)), _Response(201, _Chat(3, null)),
			_Response(200, { ..._Chat(3, null), state: "completed", completedAt: "2026-09-13T00:00:00Z" }),
		];
		const fetch = vi.fn<HostedGeneratedFileFetch>(async function _Fetch(input, init = {})
		{
			calls.push({ url: new URL(String(input)), body: typeof init.body === "string" ? JSON.parse(init.body) : null });
			return responses.shift()!;
		});
		const client = new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test"), null, fetch);
		await client.configureOpenAiProvider(1_000);
		await expect(client.openAiProviderCredentialId()).resolves.toBe("byok:tenant-a:openai");
		await expect(client.createModelDefinition("tenant-a", "http://hosted-generated-file-protocol.hosted-file-smoke.svc:4000/v1", "byok:tenant-a:openai", 1_000)).resolves.toBe("model-1");
		await client.setTenantModelDefault("tenant-a");
		await expect(client.completePersona()).resolves.toBe("persona-1");
		await client.completeOnboarding();
		expect(calls[0]!.body).toEqual({ apiKey: "opencrane-hosted-fixture-public-marker" });
		expect(calls[1]!.body).toEqual({ apiKey: "opencrane-hosted-fixture-public-marker", commandId: "provider-command-1" });
		expect(calls[2]!.url.pathname).toBe("/api/v1/models");
		expect(calls[2]!.url.search).toBe("");
		expect(calls[3]!.body).toEqual({ scope: "clusterTenant", clusterTenant: "tenant-a", publicModelName: "hosted-generated-file-model", upstreamModel: "openai/hosted-generated-file", apiBase: "http://hosted-generated-file-protocol.hosted-file-smoke.svc:4000/v1", providerCredentialId: "byok:tenant-a:openai", generatedOutputCapabilities: ["code_execution_files"] });
		expect(calls[4]!.url.pathname).toBe("/api/v1/models/model-1/registration-commands/model-command-1");
		expect(calls[5]!.body).toEqual({ scope: "clusterTenant", clusterTenant: "tenant-a", defaultModel: "hosted-generated-file-model" });
		expect(calls.filter(call => call.url.pathname.endsWith("/chat/answers")).map(call => call.body)).toEqual([
			expect.objectContaining({ expectedConversationId: "onboarding-1", expectedQuestionOrdinal: 1 }),
			expect.objectContaining({ expectedConversationId: "onboarding-1", expectedQuestionOrdinal: 2 }),
			expect.objectContaining({ expectedConversationId: "onboarding-1", expectedQuestionOrdinal: 3 }),
		]);
	});

	it("rejects an insecure public or provider transport before requesting it", function _HttpsOnly()
	{
		expect(() => new HostedGeneratedFilePublicClient(new URL("http://smoke.opencrane.test"))).toThrow("HTTPS public server");
		expect(() => new HostedGeneratedFilePublicClient(new URL("https://smoke.opencrane.test"), new URL("http://127.0.0.1:9443"))).toThrow("HTTPS OIDC transport");
	});
});

describe("hosted generated-file evidence", function _EvidenceSuite()
{
	it("binds upload, admission, and registry evidence to the exact OCI archive", function _OciContinuity()
	{
		const archive = Buffer.from("exact-oci-archive");
		const digest = __HostedGeneratedFileDigest(archive);
		const asset = { id: "asset-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", byteLength: archive.byteLength, displayName: "producer.zip", mediaType: "application/zip", messageId: null, provenance: "participant_upload", state: "ready" };
		const validation = { id: "validation-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", byteLength: archive.byteLength, configDigest: `sha256:${"a".repeat(64)}`, contentAddress: digest, imageManifestDigest: `sha256:${"b".repeat(64)}`, indexDigest: `sha256:${"c".repeat(64)}`, mediaType: "application/zip", registryReference: `registry.test/opencrane/mcp@sha256:${"b".repeat(64)}`, state: "Imported" };
		expect(() => __AssertHostedOciContinuity(asset, validation, archive)).not.toThrow();
		expect(() => __AssertHostedOciContinuity(asset, { ...validation, artifactRevisionId: "changed" }, archive)).toThrow("exact published revision");
		expect(() => __AssertHostedOciContinuity(asset, { ...validation, registryReference: "http://registry.test/latest" }, archive)).toThrow("digest-pinned registry evidence");
	});

	it("requires byte-identical no-store CSV downloads", function _Download()
	{
		const expected = Buffer.from("name,value\nalpha,1\n");
		expect(() => __AssertHostedDownload(expected, expected, "text/csv;charset=utf-8", "private, no-store")).not.toThrow();
		expect(() => __AssertHostedDownload(Buffer.from("different"), expected, "text/csv;charset=utf-8", "private, no-store")).toThrow("bytes changed");
		expect(() => __AssertHostedDownload(expected, expected, "text/csv;charset=utf-8", "public, max-age=60")).toThrow("no-store");
	});
});

describe("hosted generated-file HTTP projections", function _ProjectionSuite()
{
	it("requires named fields and strips unrelated public API fields", function _ProjectionValidation()
	{
		const asset = { id: "asset-1", artifactId: null, artifactRevisionId: null, byteLength: 12, displayName: "file.csv", mediaType: "text/csv", messageId: null, provenance: "agent_output", state: "ready", unrelated: "discard" };
		const validation = { id: "validation-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", byteLength: 12, configDigest: null, contentAddress: `sha256:${"a".repeat(64)}`, imageManifestDigest: null, indexDigest: null, mediaType: "application/zip", registryReference: null, state: "Pending", unrelated: "discard" };
		const run = { runId: "run-1", attempt: 1, state: "completed", conversationId: "conversation-1", agentRevisionId: "revision-1", finishedAt: "2026-09-13T00:00:00Z", unrelated: "discard" };
		const selection = { agentServiceId: "agent-1", activeRevisionId: "revision-1", toolRevisionIds: ["tool-1"], unrelated: "discard" };
		expect(__HostedAsset(asset)).not.toHaveProperty("unrelated");
		expect(__HostedValidation(validation)).not.toHaveProperty("unrelated");
		expect(__HostedRun(run)).not.toHaveProperty("unrelated");
		expect(__HostedToolSelection(selection)).not.toHaveProperty("unrelated");
		expect(() => __HostedAsset({ ...asset, id: undefined })).toThrow();
		expect(() => __HostedValidation({ ...validation, contentAddress: undefined })).toThrow();
		expect(() => __HostedRun({ ...run, attempt: "one" })).toThrow();
		expect(() => __HostedToolSelection({ ...selection, toolRevisionIds: [""] })).toThrow();
	});
});

describe("hosted generated-file prerequisites", function _PrerequisiteSuite()
{
	it("accepts only the four prerequisite coordinates and rejects seeded outcome fields", async function _ClosedShape()
	{
		const directory = await mkdtemp(join(tmpdir(), "opencrane-hosted-prerequisites-"));
		_TemporaryDirectories.push(directory);
		const valid = join(directory, "valid.json");
		await writeFile(valid, JSON.stringify({ personalAgentRef: "personal-agent-1", expectedModelDefinitionId: "model-1", expectedPrincipalId: "principal-1", expectedSiloId: "silo-1" }));
		await expect(__LoadHostedGeneratedFilePrerequisites(valid)).resolves.toEqual({ personalAgentRef: "personal-agent-1", expectedModelDefinitionId: "model-1", expectedPrincipalId: "principal-1", expectedSiloId: "silo-1" });

		const forbidden = join(directory, "forbidden.json");
		await writeFile(forbidden, JSON.stringify({ personalAgentRef: "personal-agent-1", expectedModelDefinitionId: "model-1", expectedPrincipalId: "principal-1", expectedSiloId: "silo-1", importedValidationId: "fabricated" }));
		await expect(__LoadHostedGeneratedFilePrerequisites(forbidden)).rejects.toThrow("unsupported or missing coordinates");
	});

	it("accepts only a non-empty Principal from the deployment silo", function _PrincipalCoordinate()
	{
		expect(__HostedGeneratedFilePrincipalId({ principalId: "principal-1", siloId: "silo-1" }, "silo-1")).toBe("principal-1");
		expect(() => __HostedGeneratedFilePrincipalId(null, "silo-1")).toThrow("configured OIDC identity and silo");
		expect(() => __HostedGeneratedFilePrincipalId({ principalId: "principal-1", siloId: "other" }, "silo-1")).toThrow("configured OIDC identity and silo");
		expect(() => __HostedGeneratedFilePrincipalId({ principalId: "", siloId: "silo-1" }, "silo-1")).toThrow("configured OIDC identity and silo");
	});

	it("builds only the exact post-install Personal Assign grant", function _AssignPrerequisite()
	{
		const prerequisites = { personalAgentRef: "agent-1", expectedModelDefinitionId: "model-1", expectedPrincipalId: "principal-1", expectedSiloId: "silo-1" };
		const command = __HostedGeneratedFileAssignCommand(prerequisites, { state: "discovered-published-installed", toolRevisionId: "tool-1" }, new Date("2026-09-13T00:00:00Z"));
		expect(command).toMatchObject({ siloId: "silo-1", managerId: "hosted-generated-file-prerequisite:principal-1", resource: { kind: "mcp-tool-revision", id: "tool-1" }, grants: [{ subject: { kind: "principal", principalId: "principal-1" }, boundary: { kind: "personal", principalId: "principal-1" }, boundaryCoverage: "exact", priority: 0, createdByPrincipalId: "principal-1" }] });
		expect(command.grants[0]!.capability.capabilityId).toContain("assign");
		expect(() => __HostedGeneratedFileAssignCommand(prerequisites, { state: "pending" as never, toolRevisionId: "tool-1" }, new Date())).toThrow("completed public discovery");
	});

	it("rejects service, successor, and committed-selection drift", function _SelectionChecks()
	{
		const before = { agentServiceId: "agent-1", activeRevisionId: "revision-1", toolRevisionIds: [] };
		const selected = { agentServiceId: "agent-1", activeRevisionId: "revision-2", toolRevisionIds: ["tool-1"] };
		expect(() => __AssertHostedToolSelection(before, selected, selected, "agent-1", "tool-1")).not.toThrow();
		expect(() => __AssertHostedToolSelection({ ...before, agentServiceId: "other" }, selected, selected, "agent-1", "tool-1")).toThrow("expected empty service");
		expect(() => __AssertHostedToolSelection(before, { ...selected, activeRevisionId: "revision-1" }, selected, "agent-1", "tool-1")).toThrow("exact successor");
		expect(() => __AssertHostedToolSelection(before, selected, { ...selected, toolRevisionIds: [] }, "agent-1", "tool-1")).toThrow("durably committed");
		for (const toolRevisionIds of [["other"], ["tool-1", "other"]])
			expect(() => __AssertHostedToolSelection(before, { ...selected, toolRevisionIds }, selected, "agent-1", "tool-1")).toThrow("exact successor");
	});

	it("requires exact completed run, answer, and output asset coordinates", function _TerminalProjection()
	{
		const asset = { id: "asset-output", artifactId: "artifact-1", artifactRevisionId: "artifact-revision-1", byteLength: 12, displayName: "result.csv", mediaType: "text/csv;charset=utf-8", messageId: "answer-1", provenance: "agent_output", state: "ready" };
		const run = { runId: "run-1", attempt: 1, state: "completed", conversationId: "conversation-1", agentRevisionId: "agent-revision-2", finishedAt: "2026-09-13T00:00:00Z" };
		const history = { nextPosition: "3", entries: [{ id: "answer-1", kind: "message", state: "completed", runId: "run-1", author: { kind: "agent" }, blocks: [{ id: "text-1", kind: "text" }, { id: "asset-output", kind: "artifact", artifactId: "artifact-1", artifactRevisionId: "artifact-revision-1", name: "result.csv", mediaType: "text/csv;charset=utf-8" }] }] };
		expect(_ReadTerminalProjection(history, [asset], [run], "conversation-1")).toEqual({ finalPosition: "3", output: asset, run });
		expect(_ReadTerminalProjection(history, [{ ...asset, artifactRevisionId: "changed" }], [run], "conversation-1")).toBeNull();
	});

	it("uses deployment-selected silo and the real producer tool name", function _EnvironmentContract()
	{
		const config = __HostedGeneratedFileConfig(_Environment());
		expect(config.siloId).toBe("tenant-a");
		expect(config.namespace).toBe("hosted-file-smoke");
		expect(config.providerApiBaseUrl).toBe("http://hosted-generated-file-protocol.hosted-file-smoke.svc:4000/v1");
		expect(config.expectedToolName).toBe("opencrane_files_create_csv");
		expect(config.databaseUrl).toBeNull();
	});

	it.each([
		{ OPENCRANE_HOSTED_QUALIFICATION_BASE_URL: "https://smoke.example.test:8443" },
		{ OPENCRANE_HOSTED_QUALIFICATION_BASE_URL: "https://smoke.opencrane.test:9443" },
		{ OPENCRANE_HOSTED_QUALIFICATION_BASE_URL: "https://-bad.opencrane.test:8443" },
		{ OPENCRANE_HOSTED_QUALIFICATION_BASE_TRANSPORT_ADDRESS: "127.0.0.2" },
		{ OPENCRANE_HOSTED_QUALIFICATION_NAMESPACE: "Bad_Name" },
	])("rejects unsafe public routing before a client can mutate (%o)", function _UnsafeEnvironment(override)
	{
		expect(() => __HostedGeneratedFileConfig(_Environment(override))).toThrow();
	});

	it.each(["OPENCRANE_HOSTED_QUALIFICATION_UPSTREAM_API_KEY", "OPENCRANE_HOSTED_QUALIFICATION_UPSTREAM_API_KEY_PATH", "OPENCRANE_HOSTED_QUALIFICATION_PROVIDER_API_BASE_URL", "HOSTED_UPSTREAM_KEY_PATH"])("rejects external provider input %s", function _ProviderInput(name)
	{
		expect(() => __HostedGeneratedFileConfig(_Environment({ [name]: "untrusted" }))).toThrow("does not accept provider key or provider URL inputs");
	});

	it("contains no workflow engine, worker, or task-handler import or invocation", async function _OwnerBoundary()
	{
		const directory = new URL(".", import.meta.url);
		const files = (await readdir(directory)).filter(file => file.endsWith(".ts"));
		const sources = await Promise.all(files.map(async function _Read(file) { return readFile(new URL(file, directory), "utf8"); }));
		const source = sources.join("\n");
		expect(source).not.toMatch(/from\s+["'][^"']*(?:infra\/workflows|workflow-composition|workflow-engine|task-handler|background-workers)[^"']*["']/u);
		expect(source).not.toMatch(/\.(?:spawn|emitEventInTransaction|registerTask|startWorker|handleTask)\s*\(/u);
	});
});

/** Build one Fetch-compatible response for the synthetic contract tests. */
function _Response(status: number, body: unknown, headers: Record<string, string> = {}): Response
{
	const responseBody = body === null ? null : JSON.stringify(body);
	const responseHeaders = new Headers(headers);
	if (body !== null)
		responseHeaders.set("content-type", "application/json");
	return new Response(responseBody, { status, headers: responseHeaders });
}

/** Build one authoritative onboarding projection for a selected next question. */
function _Chat(answerCount: number, nextOrdinal: number | null): Record<string, unknown>
{
	return { state: "bootstrap_chat_in_progress", conversationId: "onboarding-1", currentQuestion: nextOrdinal === null ? null : { ordinal: nextOrdinal, text: `Question ${nextOrdinal}` }, answerCount, canConclude: answerCount === 3 };
}

/** Build the complete safe runner environment before applying one negative override. */
function _Environment(override: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv
{
	return { OPENCRANE_HOSTED_QUALIFICATION_BASE_URL: "https://smoke.opencrane.test:8443", OPENCRANE_HOSTED_QUALIFICATION_BASE_TRANSPORT_ADDRESS: "127.0.0.1", OPENCRANE_HOSTED_QUALIFICATION_EVIDENCE_PATH: "/tmp/evidence.json", OPENCRANE_HOSTED_QUALIFICATION_EXPECTED_CSV_PATH: "/tmp/expected.csv", OPENCRANE_HOSTED_QUALIFICATION_NAMESPACE: "hosted-file-smoke", OPENCRANE_HOSTED_QUALIFICATION_OCI_LAYOUT_ZIP_PATH: "/tmp/producer.zip", OPENCRANE_HOSTED_QUALIFICATION_OIDC_EMAIL: "requester@smoke.test", OPENCRANE_HOSTED_QUALIFICATION_OIDC_ISSUER: "https://issuer.test", OPENCRANE_HOSTED_QUALIFICATION_OIDC_SUBJECT: "requester", OPENCRANE_HOSTED_QUALIFICATION_OWNER_OIDC_EMAIL: "owner@smoke.test", OPENCRANE_HOSTED_QUALIFICATION_OWNER_OIDC_SUBJECT: "owner", OPENCRANE_HOSTED_QUALIFICATION_PREREQUISITES_PATH: "/tmp/prerequisites.json", OPENCRANE_HOSTED_QUALIFICATION_SILO_ID: "tenant-a", ...override };
}

/** Listen on one ephemeral loopback port without accepting external traffic. */
function _Listen(server: Server): Promise<number>
{
	return new Promise(function _Start(resolve, reject)
	{
		server.once("error", reject);
		server.listen(0, "127.0.0.1", function _Listening()
		{
			server.removeListener("error", reject);
			const address = server.address();
			if (address === null || typeof address === "string")
			{
				reject(new Error("Hosted timeout fixture did not bind an IP socket"));
				return;
			}
			resolve(address.port);
		});
	});
}

/** Close the loopback fixture after the client releases every timed-out socket. */
function _Close(server: Server): Promise<void>
{
	return new Promise(function _Stop(resolve, reject)
	{
		server.close(function _Closed(error)
		{
			if (error === undefined)
				resolve();
			else
				reject(error);
		});
	});
}
