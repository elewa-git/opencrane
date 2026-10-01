import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { HttpMethod, RequestContext, type ConfigurationOptions } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { KubernetesMcpConnectionSecretStore } from "../kubernetes-mcp-connection-secret-store";
import { HmacMcpConnectionMaterialVerifier } from "../mcp-connection-material-verifier";
import { McpConnectionSecretDeleteOutcomes, McpConnectionSecretReadOutcomes, McpConnectionSecretWriteOutcomes, type McpConnectionSecretTarget } from "../mcp-connection.types";

const _TOKEN = "write-only-token";
const _VERIFIER = new HmacMcpConnectionMaterialVerifier({ currentKeyId: "test", keys: [{ id: "test", secretBase64: Buffer.alloc(32, 4).toString("base64") }] });
const _MATERIAL = _VERIFIER.current(_TOKEN);
const _TARGET: McpConnectionSecretTarget = { connectionId: "2b7779ed-7e23-4ec5-a348-1733dc18af45", siloId: "silo-1", ownerPrincipalId: "principal-1", generation: 2, endpointDigest: `sha256:${"a".repeat(64)}`, materialVerifier: _MATERIAL.verifier, materialVerifierKeyId: _MATERIAL.keyId };

describe("Kubernetes MCP connection Secret store", () =>
{
	it("creates one immutable Secret in the configured namespace", async () =>
	{
		const createNamespacedSecret = vi.fn(async ({ body }) => ({ ...body, metadata: { ...body.metadata, uid: "uid-1", resourceVersion: "7" } }));
		const store = new KubernetesMcpConnectionSecretStore({ createNamespacedSecret } as never, "mcp-credentials", _VERIFIER, _Logger());

		await expect(store.createOrRecover(_TARGET, _TOKEN)).resolves.toEqual({ outcome: McpConnectionSecretWriteOutcomes.Created, identity: { secretRef: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2", secretUid: "uid-1", secretResourceVersion: "7" } });
		const request = createNamespacedSecret.mock.calls[0][0];
		expect(request.namespace).toBe("mcp-credentials");
		expect(request.body).toMatchObject({ immutable: true, type: "Opaque", data: { token: Buffer.from(_TOKEN).toString("base64") }, metadata: { namespace: "mcp-credentials", labels: { "opencrane.ai/purpose": "mcp-connection" }, annotations: { "opencrane.ai/endpoint-digest": _TARGET.endpointDigest, "opencrane.ai/material-verifier": _TARGET.materialVerifier } } });
	});

	it("recovers a lost create response only from matching immutable evidence", async () =>
	{
		const secret = _Secret();
		const store = new KubernetesMcpConnectionSecretStore({ createNamespacedSecret: vi.fn(async () => { throw { statusCode: 409 }; }), readNamespacedSecret: vi.fn(async () => secret) } as never, "mcp-credentials", _VERIFIER, _Logger());

		await expect(store.createOrRecover(_TARGET, _TOKEN)).resolves.toMatchObject({ outcome: McpConnectionSecretWriteOutcomes.Recovered, identity: { secretUid: "uid-1" } });
		await expect(store.createOrRecover(_TARGET, "different-token")).resolves.toEqual({ outcome: McpConnectionSecretWriteOutcomes.Conflict });
	});

	it("rejects stale object identity and deletes only with saved preconditions", async () =>
	{
		const deleteNamespacedSecret = vi.fn(async () => ({}));
		const store = new KubernetesMcpConnectionSecretStore({ readNamespacedSecret: vi.fn(async () => _Secret()), deleteNamespacedSecret } as never, "mcp-credentials", _VERIFIER, _Logger());
		const exact = { ..._TARGET, expectedIdentity: { secretRef: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2", secretUid: "uid-1", secretResourceVersion: "7" } };

		await expect(store.readExact({ ...exact, expectedIdentity: { ...exact.expectedIdentity, secretUid: "other" } })).resolves.toEqual({ outcome: McpConnectionSecretReadOutcomes.Conflict });
		await expect(store.deleteExact(exact)).resolves.toEqual({ outcome: McpConnectionSecretDeleteOutcomes.Deleted });
		expect(deleteNamespacedSecret).toHaveBeenCalledWith({ name: exact.expectedIdentity.secretRef, namespace: "mcp-credentials", body: { preconditions: { uid: "uid-1", resourceVersion: "7" } } });
	});

	it("recovers only the identity of a previously created matching Secret", async () =>
	{
		const store = new KubernetesMcpConnectionSecretStore({ readNamespacedSecret: vi.fn(async () => _Secret()) } as never, "mcp-credentials", _VERIFIER, _Logger());

		await expect(store.recoverIdentity(_TARGET)).resolves.toEqual({ outcome: McpConnectionSecretReadOutcomes.Found, identity: { secretRef: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2", secretUid: "uid-1", secretResourceVersion: "7" } });
	});

	it("records a content-free warning for an uncertain Kubernetes failure", async () =>
	{
		const logger = _Logger();
		const store = new KubernetesMcpConnectionSecretStore({ readNamespacedSecret: vi.fn(async () => { throw new Error(`failed with ${_TOKEN}`); }) } as never, "mcp-credentials", _VERIFIER, logger);
		const exact = { ..._TARGET, expectedIdentity: { secretRef: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2", secretUid: "uid-1", secretResourceVersion: "7" } };

		await expect(store.readExact(exact)).resolves.toEqual({ outcome: McpConnectionSecretReadOutcomes.Uncertain });
		expect(logger.warn).toHaveBeenCalledOnce();
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(_TOKEN);
	});

	it("appends the read deadline while preserving an existing Kubernetes request signal", async function _ReadSignal()
	{
		const existing = [new AbortController(), new AbortController()];
		const observed: AbortSignal[] = [];
		const readNamespacedSecret = vi.fn(async function _Read(_command: unknown, options?: ConfigurationOptions)
		{
			const context = new RequestContext("https://kubernetes.example.test/secret", HttpMethod.GET);
			context.setSignal(existing[observed.length]!.signal);
			const configured = await options?.middleware?.[0]?.pre(context).toPromise();
			if (configured !== undefined && configured.getSignal() !== undefined)
				observed.push(configured.getSignal()!);
			return _Secret();
		});
		const store = new KubernetesMcpConnectionSecretStore({ readNamespacedSecret } as never, "mcp-credentials", _VERIFIER, _Logger());
		const exact = { ..._TARGET, expectedIdentity: { secretRef: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2", secretUid: "uid-1", secretResourceVersion: "7" } };
		const callers = [new AbortController(), new AbortController()];

		await expect(store.readExact(exact, callers[0]!.signal)).resolves.toMatchObject({ outcome: McpConnectionSecretReadOutcomes.Found });
		existing[0]!.abort();
		expect(observed[0]?.aborted).toBe(true);

		await expect(store.readExact(exact, callers[1]!.signal)).resolves.toMatchObject({ outcome: McpConnectionSecretReadOutcomes.Found });
		callers[1]!.abort();
		expect(observed[1]?.aborted).toBe(true);
		expect(readNamespacedSecret.mock.calls[0]?.[1]).toMatchObject({ middlewareMergeStrategy: "append" });
	});
});

function _Logger()
{
	return { warn: vi.fn() };
}

function _Secret()
{
	return {
		apiVersion: "v1",
		kind: "Secret",
		immutable: true,
		type: "Opaque",
		metadata: {
			name: "mcp-connection-2b7779ed-7e23-4ec5-a348-1733dc18af45-g2",
			namespace: "mcp-credentials",
			uid: "uid-1",
			resourceVersion: "7",
			labels: { "app.kubernetes.io/managed-by": "opencrane-server", "opencrane.ai/purpose": "mcp-connection", "opencrane.ai/connection": _Label("2b7779ed-7e23-4ec5-a348-1733dc18af45"), "opencrane.ai/silo": _Label("silo-1"), "opencrane.ai/owner": _Label("principal-1"), "opencrane.ai/generation": "2" },
			annotations: { "opencrane.ai/endpoint-digest": _TARGET.endpointDigest, "opencrane.ai/material-verifier": _TARGET.materialVerifier, "opencrane.ai/material-verifier-key-id": _TARGET.materialVerifierKeyId },
		},
		data: { token: Buffer.from(_TOKEN).toString("base64") },
	};
}

function _Label(value: string): string
{
	return `sha256-${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}
