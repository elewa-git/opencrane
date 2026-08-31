import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";

import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";

/**
 * Builds the fixed Kubernetes Secret name for one supported provider.
 *
 * The server Role grants access to the reviewed provider catalogue only. Deployment creates those
 * Secret objects before the server starts, so a provider command can replace or clear a value
 * without gaining authority to create arbitrary Secrets.
 *
 * Called by: durable provider-command admission and execution.
 *
 * @param provider - Provider identifier such as `openai`.
 * @returns The fixed release-local Secret name.
 */
export function _byokSecretName(provider: string): string
{
	return `byok-provider-key-${provider}`;
}

/**
 * Builds the fixed LiteLLM credential name for one supported provider.
 *
 * Called by: durable provider-command admission and execution.
 *
 * @param provider - Provider identifier such as `openai`.
 * @returns The stable LiteLLM credential name.
 */
export function _byokCredentialName(provider: string): string
{
	return `byok-${provider}`;
}

/**
 * Replaces the raw key in a provider's fixed release-local Secret.
 *
 * The deployed Role cannot create arbitrary Secret names. The deploy engine creates every
 * catalogue placeholder before the server rolls out, and a missing placeholder fails closed.
 *
 * Called by: the claimed Set-BYOK durable provider command.
 *
 * @param coreApi - Kubernetes client restricted to the fixed provider Secret catalogue.
 * @param namespace - Release namespace that owns the Secret.
 * @param provider - Provider whose fixed Secret receives the key.
 * @param apiKey - Raw provider material that must never be logged or persisted elsewhere.
 */
export async function _ApplyProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string, apiKey: string): Promise<void>
{
	const name = _byokSecretName(provider);
	const body: k8s.V1Secret = {
		apiVersion: "v1",
		kind: "Secret",
		metadata: {
			name,
			namespace,
			labels: {
				"app.kubernetes.io/managed-by": "opencrane-server",
				"opencrane.io/byok-provider": provider,
			},
		},
		type: "Opaque",
		data: { apiKey: Buffer.from(apiKey).toString("base64") },
	};
	const delivery = await ___DoWithTrace("kubernetes.provider-secret.apply", { namespace, provider, secretName: name }, async function _Apply()
	{
		try
		{
			const existing = await coreApi.readNamespacedSecret({ name, namespace });
			body.metadata!.resourceVersion = existing.metadata?.resourceVersion;
			await coreApi.replaceNamespacedSecret({ name, namespace, body });
			return { failed: false } as const;
		}
		catch (error)
		{
			___MarkActiveSpanFailed();
			const failure = _k8sStatus(error) === 404
				? new Error(`Provider custody Secret '${name}' is missing; deployment must pre-create the fixed provider catalogue`)
				: error;
			return { failed: true, error: failure } as const;
		}
	});
	if (delivery.failed)
		throw delivery.error;
}

/**
 * Clears the raw key while retaining the fixed provider Secret object.
 *
 * Keeping the object lets a later governed command replace the value even though the server Role
 * cannot create Secrets.
 *
 * Called by: the claimed Delete-BYOK durable provider command.
 *
 * @param coreApi - Kubernetes client restricted to the fixed provider Secret catalogue.
 * @param namespace - Release namespace that owns the Secret.
 * @param provider - Provider whose fixed Secret is cleared.
 */
export async function _ClearProviderKeySecret(coreApi: k8s.CoreV1Api, namespace: string, provider: string): Promise<void>
{
	const name = _byokSecretName(provider);
	const delivery = await ___DoWithTrace("kubernetes.provider-secret.clear", { namespace, provider, secretName: name }, async function _Clear()
	{
		try
		{
			const existing = await coreApi.readNamespacedSecret({ name, namespace });
			await coreApi.replaceNamespacedSecret({
				name,
				namespace,
				body: { ...existing, data: { apiKey: Buffer.from("").toString("base64") } },
			});
			return { failed: false } as const;
		}
		catch (error)
		{
			___MarkActiveSpanFailed();
			const failure = _k8sStatus(error) === 404
				? new Error(`Provider custody Secret '${name}' is missing; deployment must pre-create the fixed provider catalogue`)
				: error;
			return { failed: true, error: failure } as const;
		}
	});
	if (delivery.failed)
		throw delivery.error;
}

/** Reads a Kubernetes status code from the supported client error shapes. */
function _k8sStatus(error: unknown): number | undefined
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
