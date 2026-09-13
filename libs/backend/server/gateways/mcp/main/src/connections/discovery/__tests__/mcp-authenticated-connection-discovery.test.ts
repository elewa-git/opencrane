import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpConnectionFailureCodes, McpCredentialRequirement } from "@opencrane/contracts";
import { McpRemoteDeliveryStates, McpRemoteTransportError, type McpRemoteClient } from "@opencrane/backend/server/infra/mcp-remote-client";

import { StandardMcpAuthenticatedConnectionDiscovery } from "../mcp-authenticated-connection-discovery";
import { McpAuthenticatedConnectionDiscoveryOutcomes, McpRemoteRevisionFinalizationOutcomes, type McpAuthenticatedConnectionDiscoveryInput, type McpRemoteRevisionFinalizer } from "../mcp-authenticated-connection-discovery.types";
import { __McpConnectionEndpointDigest } from "../../mcp-connection-digests";
import { McpConnectionStates, type McpConnectionRecord } from "../../mcp-connection.types";

const _ENDPOINT = "https://mcp.example.test/stream";

/** Build an activating credentialless record without Secret coordinates. */
function _Record(changes: Partial<McpConnectionRecord> = {}): McpConnectionRecord
{
	return {
		id: "connection-1", siloId: "silo-1", installId: "install-1", serverId: "server-1", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 1,
		credentialRequirement: McpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKinds.None, endpointDigest: __McpConnectionEndpointDigest(_ENDPOINT), state: McpConnectionStates.Activating,
		requestKeyDigest: `sha256:${"a".repeat(64)}`, commandDigest: `sha256:${"b".repeat(64)}`, materialVerifier: null, materialVerifierKeyId: null, authorizationDecisionDigest: `sha256:${"c".repeat(64)}`,
		secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, task: { taskId: "task-1", taskName: "mcp-connection-activation", taskKey: "task-key-1" },
		revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
		...changes,
	};
}

/** Build the exact workflow input for one record. */
function _Input(record = _Record()): McpAuthenticatedConnectionDiscoveryInput
{
	return { record, endpoint: _ENDPOINT, credential: { kind: McpConnectionCredentialKinds.None }, task: { taskId: record.task.taskId, taskName: record.task.taskName, idempotencyKey: record.task.taskKey }, signal: new AbortController().signal };
}

/** Build a transport with one accepted discovery response and configurable tool pages. */
function _Client(pages: readonly { readonly tools: readonly { readonly name: string; readonly description: string | null; readonly inputSchema: object }[]; readonly nextCursor: string | null; readonly cacheScope: "private" | "public" }[]): McpRemoteClient
{
	let page = 0;
	return {
		discover: vi.fn().mockResolvedValue({ protocolVersion: "2026-07-28", evidenceDigest: `sha256:${"d".repeat(64)}`, cacheScope: "private" }),
		listTools: vi.fn().mockImplementation(async function _List()
		{
			const result = pages[page];
			page += 1;
			if (!result)
				throw new Error("unexpected tools page");
			return result;
		}),
		callTool: vi.fn(),
	};
}

/** Build a finalizer that records the complete discovery command. */
function _Finalizer(outcome = McpRemoteRevisionFinalizationOutcomes.Completed): McpRemoteRevisionFinalizer
{
	return { finalize: vi.fn().mockResolvedValue({ outcome, serverRevisionId: outcome === McpRemoteRevisionFinalizationOutcomes.Completed ? "revision-1" : undefined }) };
}

describe("authenticated MCP connection discovery", function _Suite()
{
	it("paginates, sorts one complete tool set, and finalizes without authorization for credentialless servers", async function _Paginates()
	{
		const client = _Client([
			{ tools: [{ name: "zeta.read", description: null, inputSchema: { type: "object" } }], nextCursor: "page-2", cacheScope: "private" },
			{ tools: [{ name: "alpha.read", description: "Alpha", inputSchema: { type: "object" } }], nextCursor: null, cacheScope: "private" },
		]);
		const finalizer = _Finalizer();
		const discovery = new StandardMcpAuthenticatedConnectionDiscovery(client, finalizer);

		await expect(discovery.activate(_Input())).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Completed, serverRevisionId: "revision-1" });
		expect(client.discover).toHaveBeenCalledWith(expect.objectContaining({ endpoint: _ENDPOINT, authorization: undefined }));
		expect(client.listTools).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "page-2" }));
		expect(finalizer.finalize).toHaveBeenCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ name: "alpha.read" }), expect.objectContaining({ name: "zeta.read" })], discoveryDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) }));
	});

	it("holds bearer material only in remote commands", async function _UsesBearer()
	{
		const record = _Record({ credentialRequirement: McpCredentialRequirement.PrincipalCredential, credentialKind: McpConnectionCredentialKinds.Bearer, materialVerifier: `hmac-sha256:${"e".repeat(64)}`, materialVerifierKeyId: "key-1", secretRef: "secret-1", secretUid: "uid-1", secretResourceVersion: "7" });
		const client = _Client([{ tools: [], nextCursor: null, cacheScope: "private" }]);
		const discovery = new StandardMcpAuthenticatedConnectionDiscovery(client, _Finalizer());

		await discovery.activate({ ..._Input(record), credential: { kind: McpConnectionCredentialKinds.Bearer, token: "test-token" } });

		expect(client.discover).toHaveBeenCalledWith(expect.objectContaining({ authorization: { kind: "bearer", token: "test-token" } }));
	});

	it("rejects stale input before DNS or finalization", async function _RejectsStaleInput()
	{
		const client = _Client([{ tools: [], nextCursor: null, cacheScope: "private" }]);
		const finalizer = _Finalizer();
		const discovery = new StandardMcpAuthenticatedConnectionDiscovery(client, finalizer);

		await expect(discovery.activate({ ..._Input(), task: { taskId: "other", taskName: "mcp-connection-activation", idempotencyKey: "task-key-1" } })).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.DefiniteFailure, failureCode: McpConnectionFailureCodes.AuthorityEnded });
		expect(client.discover).not.toHaveBeenCalled();
		expect(finalizer.finalize).not.toHaveBeenCalled();
	});

	it.each([
		["duplicate tools", [{ tools: [{ name: "records.read", description: null, inputSchema: {} }], nextCursor: "again", cacheScope: "private" }, { tools: [{ name: "records.read", description: null, inputSchema: {} }], nextCursor: null, cacheScope: "private" }]],
		["cursor loop", [{ tools: [], nextCursor: "again", cacheScope: "private" }, { tools: [], nextCursor: "again", cacheScope: "private" }]],
		["mixed cache scopes", [{ tools: [], nextCursor: null, cacheScope: "public" }]],
	] as const)("rejects %s without saving a partial revision", async function _RejectsInvalidPages(_case, pages)
	{
		const finalizer = _Finalizer();
		const discovery = new StandardMcpAuthenticatedConnectionDiscovery(_Client(pages), finalizer);

		await expect(discovery.activate(_Input())).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.DefiniteFailure, failureCode: McpConnectionFailureCodes.DiscoveryRejected });
		expect(finalizer.finalize).not.toHaveBeenCalled();
	});

	it("maps authentication refusal and read-only transport failure separately", async function _MapsTransportFailure()
	{
		const unauthorized = _Client([]);
		vi.mocked(unauthorized.discover).mockRejectedValue(new McpRemoteTransportError("http_401", McpRemoteDeliveryStates.MaybeDispatched));
		const unavailable = _Client([]);
		vi.mocked(unavailable.discover).mockRejectedValue(new McpRemoteTransportError("network", McpRemoteDeliveryStates.MaybeDispatched));

		await expect(new StandardMcpAuthenticatedConnectionDiscovery(unauthorized, _Finalizer()).activate(_Input())).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.DefiniteFailure, failureCode: McpConnectionFailureCodes.AuthenticationRejected });
		await expect(new StandardMcpAuthenticatedConnectionDiscovery(unavailable, _Finalizer()).activate(_Input())).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Retryable });
	});

	it("reports a changed durable winner as a definite discovery failure", async function _ReportsConflict()
	{
		const discovery = new StandardMcpAuthenticatedConnectionDiscovery(_Client([{ tools: [], nextCursor: null, cacheScope: "private" }]), _Finalizer(McpRemoteRevisionFinalizationOutcomes.Conflict));

		await expect(discovery.activate(_Input())).resolves.toEqual({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.DefiniteFailure, failureCode: McpConnectionFailureCodes.DiscoveryRejected });
	});
});
