import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { Observable, type ConfigurationOptions, type CoreV1Api, type ObservableMiddleware, type RequestContext, type ResponseContext, type V1Secret } from "@kubernetes/client-node";

import { ___DoWithTrace, ___MarkActiveSpanFailed, type Logger } from "@opencrane/backend/observability";

import { McpConnectionSecretDeleteOutcomes, McpConnectionSecretReadOutcomes, McpConnectionSecretWriteOutcomes } from "./mcp-connection.types";
import type { McpConnectionCredentialSecretStore, McpConnectionMaterialVerifier, McpConnectionSecretDeleteResult, McpConnectionSecretIdentity, McpConnectionSecretReadResult, McpConnectionSecretRecoveryResult, McpConnectionSecretTarget, McpConnectionSecretWriteResult } from "./mcp-connection.types";

const _PURPOSE_LABEL = "opencrane.ai/purpose";
const _CONNECTION_LABEL = "opencrane.ai/connection";
const _SILO_LABEL = "opencrane.ai/silo";
const _OWNER_LABEL = "opencrane.ai/owner";
const _GENERATION_LABEL = "opencrane.ai/generation";
const _ENDPOINT_ANNOTATION = "opencrane.ai/endpoint-digest";
const _VERIFIER_ANNOTATION = "opencrane.ai/material-verifier";
const _VERIFIER_KEY_ANNOTATION = "opencrane.ai/material-verifier-key-id";

/** Kubernetes Secret adapter confined to the configured MCP credential namespace. */
export class KubernetesMcpConnectionSecretStore implements McpConnectionCredentialSecretStore
{
	constructor(private readonly _coreApi: CoreV1Api, private readonly _credentialNamespace: string, private readonly _verifier: McpConnectionMaterialVerifier, private readonly _logger: Pick<Logger, "warn">)
	{
		if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u.test(_credentialNamespace) || _credentialNamespace.length > 63)
			throw new Error("MCP credential namespace is invalid.");
	}

	async createOrRecover(target: McpConnectionSecretTarget, bearerToken: string): Promise<McpConnectionSecretWriteResult>
	{
		if (!this._verifier.verify(target.materialVerifierKeyId, bearerToken, target.materialVerifier))
			return { outcome: McpConnectionSecretWriteOutcomes.Conflict };
		const name = __McpConnectionSecretName(target.connectionId, target.generation);
		const body: V1Secret = {
			apiVersion: "v1",
			kind: "Secret",
			immutable: true,
			metadata: { name, namespace: this._credentialNamespace, labels: _Labels(target), annotations: _Annotations(target) },
			type: "Opaque",
			data: { token: Buffer.from(bearerToken, "utf8").toString("base64") },
		};
		return ___DoWithTrace("kubernetes.mcp-connection-secret.create", { generation: target.generation }, async () =>
		{
			try
			{
				const created = await this._coreApi.createNamespacedSecret({ namespace: this._credentialNamespace, body });
				const identity = _Identity(created, name, this._credentialNamespace);
				return identity ? { outcome: McpConnectionSecretWriteOutcomes.Created, identity } : { outcome: McpConnectionSecretWriteOutcomes.Uncertain };
			}
			catch (error)
			{
				if (_KubernetesStatus(error) !== 409)
				{
					___MarkActiveSpanFailed();
					this._LogUnavailable("create", error, target);
					return { outcome: McpConnectionSecretWriteOutcomes.Uncertain };
				}
				return this._Recover(target, name);
			}
		});
	}

	async readExact(target: McpConnectionSecretTarget, signal?: AbortSignal): Promise<McpConnectionSecretReadResult>
	{
		if (!target.expectedIdentity)
			return { outcome: McpConnectionSecretReadOutcomes.Conflict };
		if (signal?.aborted)
			return { outcome: McpConnectionSecretReadOutcomes.Uncertain };
		const name = __McpConnectionSecretName(target.connectionId, target.generation);
		return ___DoWithTrace("kubernetes.mcp-connection-secret.read", { generation: target.generation }, async () =>
		{
			try
			{
				const secret = await this._coreApi.readNamespacedSecret({ name, namespace: this._credentialNamespace }, _RequestOptions(signal));
				if (signal?.aborted)
					return { outcome: McpConnectionSecretReadOutcomes.Uncertain };
				return this._ReadResult(secret, target, name);
			}
			catch (error)
			{
				if (signal?.aborted)
					return { outcome: McpConnectionSecretReadOutcomes.Uncertain };
				if (_KubernetesStatus(error) === 404)
					return { outcome: McpConnectionSecretReadOutcomes.NotFound };
				___MarkActiveSpanFailed();
				this._LogUnavailable("read", error, target);
				return { outcome: McpConnectionSecretReadOutcomes.Uncertain };
			}
		});
	}

	async recoverIdentity(target: McpConnectionSecretTarget): Promise<McpConnectionSecretRecoveryResult>
	{
		const name = __McpConnectionSecretName(target.connectionId, target.generation);
		return ___DoWithTrace("kubernetes.mcp-connection-secret.recover-identity", { generation: target.generation }, async () =>
		{
			try
			{
				const secret = await this._coreApi.readNamespacedSecret({ name, namespace: this._credentialNamespace });
				const token = _Token(secret);
				const identity = _Identity(secret, name, this._credentialNamespace);
				if (!identity || !_MetadataMatches(secret, target, name, this._credentialNamespace) || token === null || !this._verifier.verify(target.materialVerifierKeyId, token, target.materialVerifier))
					return { outcome: McpConnectionSecretReadOutcomes.Conflict };
				return { outcome: McpConnectionSecretReadOutcomes.Found, identity };
			}
			catch (error)
			{
				if (_KubernetesStatus(error) === 404)
					return { outcome: McpConnectionSecretReadOutcomes.NotFound };
				___MarkActiveSpanFailed();
				this._LogUnavailable("recover-identity", error, target);
				return { outcome: McpConnectionSecretReadOutcomes.Uncertain };
			}
		});
	}

	async deleteExact(target: McpConnectionSecretTarget): Promise<McpConnectionSecretDeleteResult>
	{
		if (!target.expectedIdentity)
			return { outcome: McpConnectionSecretDeleteOutcomes.Conflict };
		const name = __McpConnectionSecretName(target.connectionId, target.generation);
		const observed = await this.readExact(target);
		if (observed.outcome === McpConnectionSecretReadOutcomes.NotFound)
			return { outcome: McpConnectionSecretDeleteOutcomes.NotFound };
		if (observed.outcome === McpConnectionSecretReadOutcomes.Uncertain)
			return { outcome: McpConnectionSecretDeleteOutcomes.Uncertain };
		if (observed.outcome === McpConnectionSecretReadOutcomes.Conflict)
			return { outcome: McpConnectionSecretDeleteOutcomes.Conflict };
		return ___DoWithTrace("kubernetes.mcp-connection-secret.delete", { generation: target.generation }, async () =>
		{
			try
			{
				await this._coreApi.deleteNamespacedSecret({
					name,
					namespace: this._credentialNamespace,
					body: { preconditions: { uid: target.expectedIdentity!.secretUid, resourceVersion: target.expectedIdentity!.secretResourceVersion } },
				});
				return { outcome: McpConnectionSecretDeleteOutcomes.Deleted };
			}
			catch (error)
			{
				if (_KubernetesStatus(error) === 404)
					return { outcome: McpConnectionSecretDeleteOutcomes.NotFound };
				if (_KubernetesStatus(error) === 409)
					return { outcome: McpConnectionSecretDeleteOutcomes.Conflict };
				___MarkActiveSpanFailed();
				this._LogUnavailable("delete", error, target);
				return { outcome: McpConnectionSecretDeleteOutcomes.Uncertain };
			}
		});
	}

	private async _Recover(target: McpConnectionSecretTarget, name: string): Promise<McpConnectionSecretWriteResult>
	{
		try
		{
			const secret = await this._coreApi.readNamespacedSecret({ name, namespace: this._credentialNamespace });
			const identity = _Identity(secret, name, this._credentialNamespace);
			const token = _Token(secret);
			if (!identity || !_MetadataMatches(secret, target, name, this._credentialNamespace) || token === null || !this._verifier.verify(target.materialVerifierKeyId, token, target.materialVerifier))
				return { outcome: McpConnectionSecretWriteOutcomes.Conflict };
			return { outcome: McpConnectionSecretWriteOutcomes.Recovered, identity };
		}
		catch (error)
		{
			___MarkActiveSpanFailed();
			this._LogUnavailable("recover", error, target);
			return { outcome: McpConnectionSecretWriteOutcomes.Uncertain };
		}
	}

	private _LogUnavailable(operation: string, error: unknown, target: McpConnectionSecretTarget): void
	{
		this._logger.warn({ err: new Error("Kubernetes MCP credential operation failed."), kubernetesStatus: _KubernetesStatus(error), operation, connectionId: target.connectionId, generation: target.generation }, "MCP credential custody is temporarily unavailable");
	}

	private _ReadResult(secret: V1Secret, target: McpConnectionSecretTarget, name: string): McpConnectionSecretReadResult
	{
		const token = _Token(secret);
		const identity = _Identity(secret, name, this._credentialNamespace);
		if (!identity || !_MetadataMatches(secret, target, name, this._credentialNamespace) || !_SameIdentity(identity, target.expectedIdentity!) || token === null || !this._verifier.verify(target.materialVerifierKeyId, token, target.materialVerifier))
			return { outcome: McpConnectionSecretReadOutcomes.Conflict };
		return { outcome: McpConnectionSecretReadOutcomes.Found, bearerToken: token };
	}
}

/** Append a caller deadline while retaining any signal installed by Kubernetes client middleware. */
function _RequestOptions(signal: AbortSignal | undefined): ConfigurationOptions | undefined
{
	if (signal === undefined)
		return undefined;
	const middleware: ObservableMiddleware = {
		pre(context: RequestContext): Observable<RequestContext>
		{
			const existing = context.getSignal();
			context.setSignal(existing === undefined ? signal : AbortSignal.any([existing, signal]));
			return new Observable(Promise.resolve(context));
		},
		post(context: ResponseContext): Observable<ResponseContext>
		{
			return new Observable(Promise.resolve(context));
		},
	};
	return { middleware: [middleware], middlewareMergeStrategy: "append" };
}

/** Derive the only Secret name permitted for one connection generation. */
export function __McpConnectionSecretName(connectionId: string, generation: number): string
{
	if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u.test(connectionId) || !Number.isSafeInteger(generation) || generation < 1)
		throw new Error("MCP connection Secret coordinates are invalid.");
	const name = `mcp-connection-${connectionId}-g${generation}`;
	if (name.length > 63)
		throw new Error("MCP connection Secret coordinates are invalid.");
	return name;
}

function _Labels(target: McpConnectionSecretTarget): Record<string, string>
{
	return {
		"app.kubernetes.io/managed-by": "opencrane-server",
		[_PURPOSE_LABEL]: "mcp-connection",
		[_CONNECTION_LABEL]: _LabelDigest(target.connectionId),
		[_SILO_LABEL]: _LabelDigest(target.siloId),
		[_OWNER_LABEL]: _LabelDigest(target.ownerPrincipalId),
		[_GENERATION_LABEL]: String(target.generation),
	};
}

function _Annotations(target: McpConnectionSecretTarget): Record<string, string>
{
	return { [_ENDPOINT_ANNOTATION]: target.endpointDigest, [_VERIFIER_ANNOTATION]: target.materialVerifier, [_VERIFIER_KEY_ANNOTATION]: target.materialVerifierKeyId };
}

function _MetadataMatches(secret: V1Secret, target: McpConnectionSecretTarget, name: string, namespace: string): boolean
{
	const expectedLabels = _Labels(target);
	const expectedAnnotations = _Annotations(target);
	return secret.metadata?.name === name
		&& secret.metadata.namespace === namespace
		&& secret.immutable === true
		&& secret.type === "Opaque"
		&& Object.entries(expectedLabels).every(([key, value]) => secret.metadata?.labels?.[key] === value)
		&& Object.entries(expectedAnnotations).every(([key, value]) => secret.metadata?.annotations?.[key] === value);
}

function _Identity(secret: V1Secret, name: string, namespace: string): McpConnectionSecretIdentity | null
{
	const uid = secret.metadata?.uid;
	const resourceVersion = secret.metadata?.resourceVersion;
	if (secret.metadata?.name !== name || secret.metadata.namespace !== namespace || !uid || !resourceVersion)
		return null;
	return { secretRef: name, secretUid: uid, secretResourceVersion: resourceVersion };
}

function _SameIdentity(first: McpConnectionSecretIdentity, second: McpConnectionSecretIdentity): boolean
{
	return first.secretRef === second.secretRef && first.secretUid === second.secretUid && first.secretResourceVersion === second.secretResourceVersion;
}

function _Token(secret: V1Secret): string | null
{
	const encoded = secret.data?.token;
	if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
		return null;
	const decoded = Buffer.from(encoded, "base64");
	if (decoded.length === 0 || decoded.length > 8_192 || decoded.toString("base64") !== encoded)
		return null;
	return decoded.toString("utf8");
}

function _LabelDigest(value: string): string
{
	return `sha256-${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

function _KubernetesStatus(error: unknown): number | undefined
{
	if (typeof error !== "object" || error === null)
		return undefined;
	const candidate = error as { statusCode?: unknown; code?: unknown; body?: { code?: unknown } };
	if (typeof candidate.statusCode === "number")
		return candidate.statusCode;
	if (typeof candidate.code === "number")
		return candidate.code;
	if (candidate.body && typeof candidate.body.code === "number")
		return candidate.body.code;
	return undefined;
}
