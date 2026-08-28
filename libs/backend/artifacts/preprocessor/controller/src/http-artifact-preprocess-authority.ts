import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { ArtifactPreprocessCompletion, ArtifactPreprocessControllerAuthority, ArtifactPreprocessControllerRecord, ArtifactPreprocessOutcome, ArtifactPreprocessPodBindCommand, ArtifactPreprocessWorkloadBindCommand } from "@opencrane/backend/artifacts/preprocessor/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _ParseArtifactPreprocessBindOutcome, _ParseArtifactPreprocessControllerRecord, _ParseArtifactPreprocessOutcome } from "./artifact-preprocess-http-response";
import type { ArtifactPreprocessControllerFetch, ArtifactPreprocessControllerHttpAuthorityOptions, ArtifactPreprocessControllerTokenReader } from "./controller-http.types";

/** Bound one controller-only response before the adapter parses it. */
const _MAX_RESPONSE_BYTES = 16 * 1024;

/** Read a rotating projected token without retaining it in process state. */
function _CreateTokenReader(path: string): ArtifactPreprocessControllerTokenReader
{
	return async function _ReadToken(): Promise<string>
	{
		const token = (await readFile(path, "utf8")).trim();
		if (token.length === 0)
		{
			throw new Error("projected agent-controller token is empty");
		}
		return token;
	};
}

/** Require one bounded Kubernetes DNS label used to construct the trusted server hostname. */
function _KubernetesName(value: string, name: string): string
{
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) || value.length > 63)
	{
		throw new Error(`${name} must be one Kubernetes DNS label`);
	}
	return value;
}

/** Require the exact in-cluster server origin before the adapter reads a controller token. */
function _BaseUrl(value: string, serverServiceName: string, serverNamespace: string): URL
{
	const parsed = URL.parse(value);
	const expectedHostname = `${_KubernetesName(serverServiceName, "serverServiceName")}.${_KubernetesName(serverNamespace, "serverNamespace")}.svc.cluster.local`;
	if (!parsed || parsed.protocol !== "http:" || parsed.hostname !== expectedHostname || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "")
	{
		throw new Error("OPENCRANE_INTERNAL_URL must be one in-cluster HTTP origin with no path or credentials");
	}
	return parsed;
}

/** Build headers for an authenticated JSON exchange. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Create a request signal that ends with either process shutdown or the explicit timeout. */
function _RequestSignal(shutdownSignal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal
{
	return shutdownSignal === undefined
		? AbortSignal.timeout(timeoutMilliseconds)
		: AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
}

/** Read and bound one server response before decoding its JSON. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane artifact preprocessing response exceeded the 16 KiB boundary");
		}
	}
	if (response.body === null)
	{
		throw new Error("OpenCrane artifact preprocessing authority returned no response body");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true)
	{
		const result = await reader.read();
		if (result.done)
		{
			return Buffer.concat(chunks, byteLength).toString("utf8");
		}
		byteLength += result.value.byteLength;
		if (byteLength > _MAX_RESPONSE_BYTES)
		{
			await reader.cancel();
			throw new Error("OpenCrane artifact preprocessing response exceeded the 16 KiB boundary");
		}
		chunks.push(result.value);
	}
}

/** Decode one bounded JSON response through the supplied strict validator. */
async function _ReadAndValidateJson<T>(response: Response, validator: (candidate: unknown) => T): Promise<T>
{
	return ___ParseAndValidateJson(await _ReadBoundedText(response), "OpenCrane artifact preprocessing response", validator);
}

/** Require one route identity before it is placed in an internal URL. */
function _PreprocessJobId(value: string): string
{
	if (value.length === 0 || value.length > 128)
	{
		throw new Error("artifact preprocessing authority requires one valid job id");
	}
	return value;
}

/**
 * Create the internal HTTP authority that a controller-hosted workflow uses for one PDF Job.
 *
 * The adapter reads a rotating projected controller token for every request and validates every
 * successful response before the handler can create or release a Kubernetes Job. A 409 returns
 * `null` for a claim or `conflict` for a binding, so a stale delivery cannot continue.
 *
 * @param options - Same-silo origin, projected-token path, request timeout, and test seams.
 * @returns The controller authority that claims and binds one PDF preprocessing Job.
 * @throws Error when the configured origin, token path, or timeout cannot meet the private-route boundary.
 */
export function __CreateHttpArtifactPreprocessControllerAuthority(options: ArtifactPreprocessControllerHttpAuthorityOptions): ArtifactPreprocessControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl, options.serverServiceName, options.serverNamespace);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("artifact preprocessing HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest: ArtifactPreprocessControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);

	async function _Request(path: string, method: "POST" | "PUT", body: unknown): Promise<Response>
	{
		return await fetchRequest(new URL(path, baseUrl), { method, headers: _Headers(await readToken()), body: JSON.stringify(body), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
	}

	return {
		async claimForTask(preprocessJobId: string, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessControllerRecord | null>
		{
			const acceptedPreprocessJobId = _PreprocessJobId(preprocessJobId);
			return await ___DoWithTrace("agent_controller.artifact_preprocess.claim", { preprocessJobId: acceptedPreprocessJobId }, async function _Claim(): Promise<ArtifactPreprocessControllerRecord | null>
			{
				const response = await _Request(`/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(acceptedPreprocessJobId)}/claim`, "POST", task);
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane artifact preprocessing claim failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): ArtifactPreprocessControllerRecord { return _ParseArtifactPreprocessControllerRecord(value, acceptedPreprocessJobId); });
			});
		},
		async bindWorkload(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = _PreprocessJobId(preprocessJobId);
			return await ___DoWithTrace("agent_controller.artifact_preprocess.workload_binding", { preprocessJobId: acceptedPreprocessJobId, workloadUid: command.binding.workloadUid }, async function _BindWorkload(): Promise<"bound" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(acceptedPreprocessJobId)}/workload-binding`, "PUT", { task, ...command });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane artifact preprocessing workload binding failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); });
			});
		},
		async bindFirstPod(preprocessJobId: string, task: IWorkflowTaskReceipt, command: ArtifactPreprocessPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = _PreprocessJobId(preprocessJobId);
			return await ___DoWithTrace("agent_controller.artifact_preprocess.pod_binding", { preprocessJobId: acceptedPreprocessJobId, podUid: command.binding.firstPodUid }, async function _BindFirstPod(): Promise<"bound" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(acceptedPreprocessJobId)}/pod-binding`, "PUT", { task, ...command });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane artifact preprocessing Pod binding failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); });
			});
		},
		async loadOutcome(preprocessJobId: string, deliveryCount: number, task: IWorkflowTaskReceipt): Promise<ArtifactPreprocessOutcome | null>
		{
			const acceptedPreprocessJobId = _PreprocessJobId(preprocessJobId);
			return await ___DoWithTrace("agent_controller.artifact_preprocess.outcome_load", { preprocessJobId: acceptedPreprocessJobId, deliveryCount }, async function _LoadOutcome(): Promise<ArtifactPreprocessOutcome | null>
			{
				const response = await _Request(`/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(acceptedPreprocessJobId)}/outcome/load`, "POST", { task, deliveryCount });
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane artifact preprocessing outcome load failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): ArtifactPreprocessOutcome { return _ParseArtifactPreprocessOutcome(value, acceptedPreprocessJobId, deliveryCount); });
			});
		},
		async complete(preprocessJobId: string, completion: ArtifactPreprocessCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
		{
			const acceptedPreprocessJobId = _PreprocessJobId(preprocessJobId);
			return await ___DoWithTrace("agent_controller.artifact_preprocess.completion_complete", { preprocessJobId: acceptedPreprocessJobId }, async function _Complete(): Promise<"completed" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/artifact-preprocess-jobs/${encodeURIComponent(acceptedPreprocessJobId)}/completion/complete`, "POST", { task, completion });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane artifact preprocessing completion write failed with HTTP ${response.status}`);
				}
				const outcome = await _ReadAndValidateJson(response, function _Validate(value: unknown): "bound" | "idempotent" { return _ParseArtifactPreprocessBindOutcome(value, acceptedPreprocessJobId); });
				return outcome === "bound" ? "completed" : "idempotent";
			});
		},
	};
}
