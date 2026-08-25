import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { SkillAuthoringValidationCompletion, SkillAuthoringValidationControllerAuthority, SkillAuthoringValidationControllerRecord, SkillAuthoringValidationPodBindCommand, SkillAuthoringValidationWorkloadBindCommand } from "@opencrane/backend/agents/skills/workflows/contract";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___ParseAndValidateJson } from "@opencrane/util";

import { _ParseSkillAuthoringValidationBindOutcome, _ParseSkillAuthoringValidationCompletion, _ParseSkillAuthoringValidationCompletionOutcome, _ParseSkillAuthoringValidationControllerRecord } from "./skill-authoring-validation-http-response";
import type { SkillAuthoringValidationControllerFetch, SkillAuthoringValidationControllerHttpAuthorityOptions, SkillAuthoringValidationControllerTokenReader } from "./controller-http.types";

/** Limits one controller-only API response before this adapter parses it. */
const _MAX_RESPONSE_BYTES = 16 * 1024;


/** Reads a rotating projected token without retaining it in process state. */
function _CreateTokenReader(path: string): SkillAuthoringValidationControllerTokenReader
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

/** Requires one bounded Kubernetes DNS label used to construct the trusted server hostname. */
function _KubernetesName(value: string, name: string): string
{
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(value) || value.length > 63)
	{
		throw new Error(`${name} must be one Kubernetes DNS label`);
	}
	return value;
}

/** Requires the exact in-cluster server origin before the adapter reads a controller token. */
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

/** Builds headers for an authenticated JSON exchange. */
function _Headers(token: string): Headers
{
	return new Headers({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" });
}

/** Creates a request signal that ends with either process shutdown or the explicit request timeout. */
function _RequestSignal(shutdownSignal: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal
{
	return shutdownSignal === undefined
		? AbortSignal.timeout(timeoutMilliseconds)
		: AbortSignal.any([shutdownSignal, AbortSignal.timeout(timeoutMilliseconds)]);
}

/** Reads and bounds one server response before decoding its JSON. */
async function _ReadBoundedText(response: Response): Promise<string>
{
	const declaredLength = response.headers.get("content-length");
	if (declaredLength !== null)
	{
		const parsedLength = Number(declaredLength);
		if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > _MAX_RESPONSE_BYTES)
		{
			await response.body?.cancel();
			throw new Error("OpenCrane skill authoring validation response exceeded the 16 KiB boundary");
		}
	}
	if (response.body === null)
	{
		throw new Error("OpenCrane skill authoring validation authority returned no response body");
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
			throw new Error("OpenCrane skill authoring validation response exceeded the 16 KiB boundary");
		}
		chunks.push(result.value);
	}
}

/** Decodes one bounded JSON response through the supplied strict validator. */
async function _ReadAndValidateJson<T>(response: Response, validator: (candidate: unknown) => T): Promise<T>
{
	return ___ParseAndValidateJson(await _ReadBoundedText(response), "OpenCrane skill authoring validation response", validator);
}

/** Requires the route identity before it is placed in an internal URL. */
function _ValidationId(value: string): string
{
	if (value.length === 0 || value.length > 128)
	{
		throw new Error("skill authoring validation authority requires one valid validation id");
	}
	return value;
}


/**
 * Creates the internal HTTP authority that the controller-hosted Absurd handler uses for
 * server-owned validation state.
 *
 * It reads the controller's rotating token for every request and rejects a successful response that
 * names another validation before the handler can create or release a Job. A 409 becomes the
 * authority's stale or conflict outcome, so the handler stops using the affected delivery. Called
 * by: the agent-controller entrypoint when it registers the validation handler.
 *
 * @param options - Supplies the same-silo server origin, projected-token path, timeout, and test seams.
 * @returns The authority through which the handler claims, binds, loads, and completes a validation.
 */
export function __CreateHttpSkillAuthoringValidationControllerAuthority(options: SkillAuthoringValidationControllerHttpAuthorityOptions): SkillAuthoringValidationControllerAuthority
{
	const baseUrl = _BaseUrl(options.openCraneInternalUrl, options.serverServiceName, options.serverNamespace);
	if (!isAbsolute(options.tokenPath) || !Number.isSafeInteger(options.requestTimeoutMilliseconds) || options.requestTimeoutMilliseconds < 1_000 || options.requestTimeoutMilliseconds > 60_000)
	{
		throw new Error("skill authoring validation HTTP authority requires an absolute token path and 1-60s timeout");
	}
	const fetchRequest: SkillAuthoringValidationControllerFetch = options.fetch ?? fetch;
	const readToken = options.readToken ?? _CreateTokenReader(options.tokenPath);

	async function _Request(path: string, method: "POST" | "PUT", body: unknown): Promise<Response>
	{
		return await fetchRequest(new URL(path, baseUrl), { method, headers: _Headers(await readToken()), body: JSON.stringify(body), signal: _RequestSignal(options.shutdownSignal, options.requestTimeoutMilliseconds) });
	}

	return {
		async claimForTask(validationId: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationControllerRecord | null>
		{
			const acceptedValidationId = _ValidationId(validationId);
			return await ___DoWithTrace("agent_controller.skill_authoring_validation.claim", { validationId: acceptedValidationId }, async function _Claim(): Promise<SkillAuthoringValidationControllerRecord | null>
			{
				const response = await _Request(`/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(acceptedValidationId)}/claim`, "POST", task);
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane skill authoring validation claim failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): SkillAuthoringValidationControllerRecord { return _ParseSkillAuthoringValidationControllerRecord(value, acceptedValidationId); });
			});
		},
		async bindWorkload(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationWorkloadBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedValidationId = _ValidationId(validationId);
			return await ___DoWithTrace("agent_controller.skill_authoring_validation.workload_binding", { validationId: acceptedValidationId, workloadUid: command.binding.workloadUid }, async function _BindWorkload(): Promise<"bound" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(acceptedValidationId)}/workload-binding`, "PUT", { task, ...command });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane skill authoring validation workload binding failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): "bound" | "idempotent" { return _ParseSkillAuthoringValidationBindOutcome(value, acceptedValidationId); });
			});
		},
		async bindFirstPod(validationId: string, task: IWorkflowTaskReceipt, command: SkillAuthoringValidationPodBindCommand): Promise<"bound" | "idempotent" | "conflict">
		{
			const acceptedValidationId = _ValidationId(validationId);
			return await ___DoWithTrace("agent_controller.skill_authoring_validation.pod_binding", { validationId: acceptedValidationId, podUid: command.binding.firstPodUid }, async function _BindFirstPod(): Promise<"bound" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(acceptedValidationId)}/pod-binding`, "PUT", { task, ...command });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane skill authoring validation Pod binding failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): "bound" | "idempotent" { return _ParseSkillAuthoringValidationBindOutcome(value, acceptedValidationId); });
			});
		},
		async loadCompletion(validationId: string, completionDigest: string, task: IWorkflowTaskReceipt): Promise<SkillAuthoringValidationCompletion | null>
		{
			const acceptedValidationId = _ValidationId(validationId);
			return await ___DoWithTrace("agent_controller.skill_authoring_validation.completion_load", { validationId: acceptedValidationId }, async function _LoadCompletion(): Promise<SkillAuthoringValidationCompletion | null>
			{
				const response = await _Request(`/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(acceptedValidationId)}/completion/load`, "POST", { task, completionDigest });
				if (response.status === 409)
				{
					return null;
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane skill authoring validation completion load failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): SkillAuthoringValidationCompletion { return _ParseSkillAuthoringValidationCompletion(value, acceptedValidationId); });
			});
		},
		async complete(validationId: string, completion: SkillAuthoringValidationCompletion, task: IWorkflowTaskReceipt): Promise<"completed" | "idempotent" | "conflict">
		{
			const acceptedValidationId = _ValidationId(validationId);
			return await ___DoWithTrace("agent_controller.skill_authoring_validation.complete", { validationId: acceptedValidationId }, async function _Complete(): Promise<"completed" | "idempotent" | "conflict">
			{
				const response = await _Request(`/api/internal/agent-controller/skill-authoring-validations/${encodeURIComponent(acceptedValidationId)}/completion/complete`, "POST", { task, completion });
				if (response.status === 409)
				{
					return "conflict";
				}
				if (response.status !== 200)
				{
					throw new Error(`OpenCrane skill authoring validation completion failed with HTTP ${response.status}`);
				}
				return await _ReadAndValidateJson(response, function _Validate(value: unknown): "completed" | "idempotent" { return _ParseSkillAuthoringValidationCompletionOutcome(value, acceptedValidationId); });
			});
		},
	};
}
