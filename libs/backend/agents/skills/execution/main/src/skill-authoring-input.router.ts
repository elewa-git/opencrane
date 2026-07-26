import { Readable } from "node:stream";

import { Router, type Request, type Response } from "express";

import type { SkillAuthoringInputRouterDependencies } from "./skill-authoring-input.types.js";

/** Fixed projected-token audience for the isolated authoring worker class. */
const _AUTHORING_AUDIENCE = "opencrane-skill-authoring";

/** Maximum compressed candidate bundle sent through the authoring-only input path. */
const _MAX_AUTHORING_ARCHIVE_BYTES = 16 * 1024 * 1024;

/**
 * Build the projected-token and NetworkPolicy-protected authoring-only immutable skill-input boundary.
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — sole worker-to-server egress allowance.
 * @see apps/agent-controller/helm/templates/_skill-workload-admission.tpl — admitted Job identity contract.
 */
export function __CreateSkillAuthoringInputRouter(dependencies: SkillAuthoringInputRouterDependencies): Router
{
	const router = Router();
	router.get("/skill-authoring-workloads/:workloadId/input", async function _ReadInput(request: Request, response: Response): Promise<void>
	{
		const token = _Bearer(request.header("authorization"));
		const workloadId = _Coordinate(request.params.workloadId);
		if (token === null || workloadId === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const identity = await dependencies.tokenReviewer.__Review(token, _AUTHORING_AUDIENCE);
			if (identity === null)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}
			const input = await dependencies.repository.loadForWorker(workloadId, identity);
			if (input === null)
			{
				response.status(404).json({ error: "authoring_input_unavailable" });
				return;
			}
			if (input.byteLength > _MAX_AUTHORING_ARCHIVE_BYTES)
			{
				response.status(404).json({ error: "authoring_input_unavailable" });
				return;
			}
			const bytes = await dependencies.artifactReader.read(input);
			const reader = bytes.getReader();
			const first = await reader.read();
			response.status(200).set({ "content-type": input.mediaType, "content-length": String(input.byteLength), "x-opencrane-content-address": input.contentAddress, "cache-control": "no-store" });
			const stream = Readable.from(_ReadBytes(reader, first));
			/** Terminate a half-written protected response without serialising its broker failure. */
			function _AbortStream(err: Error): void
			{
				dependencies.logger.error({ err, operation: "skill_authoring.input" }, "Skill authoring input stream failed");
				response.destroy(err);
			}
			/** Cancel the private upstream fetch when the worker closes its internal response. */
			function _CancelSource(): void
			{
				void reader.cancel().catch(function _IgnoreCancellationFailure(): void {});
			}
			response.once("close", _CancelSource);
			stream.once("error", _AbortStream).pipe(response);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_authoring.input" }, "Skill authoring input failed");
			if (!response.headersSent) response.status(503).json({ error: "authoring_input_unavailable" });
			else response.destroy(err instanceof Error ? err : new Error("authoring input stream failed"));
		}
	});
	return router;
}

/** Yield a prefetched chunk, then relay the remaining private response while preserving its errors. */
async function* _ReadBytes(reader: ReadableStreamDefaultReader<Uint8Array>, first: ReadableStreamReadResult<Uint8Array>): AsyncGenerator<Uint8Array>
{
	if (!first.done) yield first.value;
	while (true)
	{
		const next = await reader.read();
		if (next.done) return;
		yield next.value;
	}
}

/** Parse one standard bearer value without accepting multiple credentials. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}

/** Validate a durable workload coordinate before it reaches the persistence adapter. */
function _Coordinate(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
