import { readFile } from "node:fs/promises";

import type { AgentJobProjection, AgentJobStartDecision, AgentJobStatusReporter, DesiredAgentJob, DesiredAgentJobSource } from "@opencrane/backend/agent-controller";

import type { ControllerAuthorityHttpClientOptions } from "./controller-authority-http-client.types.js";

/** Private HTTP adapter; it owns no controller state and rereads a rotating projected token. */
export class _ControllerAuthorityHttpClient implements DesiredAgentJobSource, AgentJobStatusReporter
{
	/** Immutable adapter configuration. */
	private readonly options: ControllerAuthorityHttpClientOptions;

	/** Creates the private OpenCrane controller-authority client. */
	constructor(options: ControllerAuthorityHttpClientOptions)
	{
		this.options = options;
	}

	/** Reads at most one server-issued desired Job. */
	async readNext(): Promise<DesiredAgentJob | null>
	{
		const response = await this._request("/desired", "GET");
		if (!response.ok) throw new Error(`controller desired request failed: ${response.status}`);
		const body = await response.json() as { readonly desired?: unknown };
		if (body.desired === null || body.desired === undefined) return null;
		return _desired(body.desired);
	}

	/** Sends a bounded rejection for a server-issued desired Job. */
	async rejectDesired(desired: DesiredAgentJob, reason: "invalid_desired_job" | "unsafe_existing_job"): Promise<void>
	{
		await this._noContent("/desired/reject", { runId: desired.runId, attempt: desired.attempt, reason });
	}

	/** Acknowledges only a Kubernetes-observed Job UID. */
	async recordJob(desired: DesiredAgentJob, projection: AgentJobProjection, workloadUid: string): Promise<AgentJobStartDecision>
	{
		const response = await this._request("/workloads/job", "POST", { runId: desired.runId, attempt: desired.attempt, workloadName: projection.name, workloadUid });
		if (!response.ok) throw new Error(`controller Job acknowledgement failed: ${response.status}`);
		const body = await response.json() as { readonly bootstrapReady?: unknown };
		if (typeof body.bootstrapReady !== "boolean") throw new Error("controller Job acknowledgement returned an invalid start decision");
		return { bootstrapReady: body.bootstrapReady };
	}

	/** Acknowledges only the first Kubernetes-observed Pod UID. */
	async recordPod(desired: DesiredAgentJob, projection: AgentJobProjection, workloadUid: string, podUid: string): Promise<void>
	{
		await this._noContent("/workloads/pod", { runId: desired.runId, attempt: desired.attempt, workloadName: projection.name, workloadUid, podUid });
	}

	/** Sends one authenticated private request with a freshly read rotating token. */
	private async _request(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<Response>
	{
		const token = (await readFile(this.options.tokenPath, "utf8")).trim();
		if (token.length === 0) throw new Error("controller projected authority token is empty");
		return this.options.fetch(new URL(path, this.options.baseUrl), { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
	}

	/** Requires an exact no-content successful authority response. */
	private async _noContent(path: string, body: Record<string, unknown>): Promise<void>
	{
		const response = await this._request(path, "POST", body);
		if (response.status !== 204) throw new Error(`controller authority request failed: ${response.status}`);
	}
}

/** Validates the exact server-issued desired Job shape before Kubernetes projection. */
function _desired(value: unknown): DesiredAgentJob
{
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("controller desired response is malformed");
	const desired = value as Record<string, unknown>;
	const strings = ["runId", "agentServiceId", "agentRevisionId", "siloId", "subjectId", "namespace", "serviceAccountName", "image"];
	if (strings.some(function _invalid(key) { return typeof desired[key] !== "string" || (desired[key] as string).trim().length === 0; }) || !Number.isSafeInteger(desired.attempt) || (desired.attempt as number) < 1) throw new Error("controller desired response is malformed");
	return desired as unknown as DesiredAgentJob;
}
