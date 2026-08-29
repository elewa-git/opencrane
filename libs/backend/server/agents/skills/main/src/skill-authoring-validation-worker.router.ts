import { Readable } from "node:stream";

import { Router, type Request, type Response } from "express";

import { __HashSkillWorkloadBootstrapReference, __IsSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import type { SkillAuthoringValidationWorkerRouterDependencies } from "./skill-authoring-validation-worker.types";
import { _ParseSkillAuthoringValidationWorkerCompletion } from "./skill-authoring-validation-worker.validator";

/** Maximum compressed skill bundle accepted by the isolated validation image. */
const _MAXIMUM_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** Create the one-use bootstrap, immutable input, and terminal completion worker protocol. */
export function __CreateSkillAuthoringValidationWorkerRouter(dependencies: SkillAuthoringValidationWorkerRouterDependencies): Router
{
	const router = Router();
	router.post(/^\/skill-authoring-validations:bootstrap$/u, async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		const reference = _Reference(request.body);
		const token = _Bearer(request.header("authorization"));
		if (reference === null || token === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			// 1. Resolve only the stored reference hash so the request cannot select a validation identity.
			const record = await dependencies.authority.loadBootstrap(await __HashSkillWorkloadBootstrapReference(reference));
			if (record === null)
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}

			// 2. Require the deployment-fixed authoring identity and the exact Pod saved before Job release.
			const identity = await dependencies.tokenReviewer.__Review(token);
			if (identity === null || identity.namespace !== record.namespace || identity.serviceAccountName !== record.serviceAccountName || identity.podUid !== record.podUid)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}

			// 3. Spend the reference once and reveal only the server-selected validation identifier.
			const outcome = await dependencies.authority.consumeBootstrap(await __HashSkillWorkloadBootstrapReference(reference), identity);
			if (outcome !== "consumed")
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}
			response.status(200).json({ acknowledged: true, validationId: record.validationId });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_authoring_validation.bootstrap" }, "Skill validation bootstrap failed");
			response.status(503).json({ error: "bootstrap_authority_unavailable" });
		}
	});

	router.get("/skill-authoring-validations/:validationId/input", async function _Input(request: Request, response: Response): Promise<void>
	{
		const validationId = _Coordinate(request.params.validationId);
		const token = _Bearer(request.header("authorization"));
		if (validationId === null || token === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const identity = await dependencies.tokenReviewer.__Review(token);
			if (identity === null)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}
			const input = await dependencies.authority.loadInput(validationId, identity);
			if (input === null || input.byteLength > _MAXIMUM_ARCHIVE_BYTES)
			{
				response.status(404).json({ error: "authoring_input_unavailable" });
				return;
			}
			const bytes = await dependencies.artifactReader.read(input);
			const reader = bytes.getReader();
			const first = await reader.read();
			response.status(200).set({ "content-type": input.mediaType, "content-length": String(input.byteLength), "x-opencrane-content-address": input.contentAddress, "cache-control": "no-store" });
			const stream = Readable.from(_ReadBytes(reader, first));
			function _AbortStream(err: Error): void
			{
				dependencies.logger.error({ err, operation: "skill_authoring_validation.input" }, "Skill validation input stream failed");
				response.destroy(err);
			}
			function _CancelSource(): void
			{
				void reader.cancel().catch(function _IgnoreCancellationFailure(): void {});
			}
			response.once("close", _CancelSource);
			stream.once("error", _AbortStream).pipe(response);
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_authoring_validation.input" }, "Skill validation input failed");
			if (!response.headersSent)
				response.status(503).json({ error: "authoring_input_unavailable" });
			else response.destroy(err instanceof Error ? err : new Error("skill validation input failed"));
		}
	});

	router.post(/^\/skill-authoring-validations:complete$/u, async function _Complete(request: Request, response: Response): Promise<void>
	{
		const token = _Bearer(request.header("authorization"));
		const command = _ParseSkillAuthoringValidationWorkerCompletion(request.body);
		if (token === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		if (command === null)
		{
			response.status(400).json({ error: "invalid_completion" });
			return;
		}
		try
		{
			const identity = await dependencies.tokenReviewer.__Review(token);
			if (identity === null)
			{
				response.status(401).json({ error: "worker_identity_denied" });
				return;
			}
			const outcome = await dependencies.authority.complete(command, identity);
			if (outcome === "conflict")
			{
				response.status(409).json({ error: "completion_unavailable" });
				return;
			}
			response.status(200).json({ completed: true });
		}
		catch (err)
		{
			dependencies.logger.error({ err, operation: "skill_authoring_validation.completion" }, "Skill validation completion failed");
			response.status(503).json({ error: "completion_authority_unavailable" });
		}
	});
	return router;
}

/** Yield the already-read chunk followed by every remaining artifact chunk. */
async function* _ReadBytes(reader: ReadableStreamDefaultReader<Uint8Array>, first: ReadableStreamReadResult<Uint8Array>): AsyncGenerator<Uint8Array>
{
	if (!first.done)
		yield first.value;
	while (true)
	{
		const next = await reader.read();
		if (next.done)
			return;
		yield next.value;
	}
}

/** Read one opaque bootstrap reference and reject every additional body field. */
function _Reference(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 1 && __IsSkillWorkloadBootstrapReference(body["bootstrapReference"]) ? body["bootstrapReference"] : null;
}

/** Read one bearer token without accepting a second credential or whitespace. */
function _Bearer(value: string | undefined): string | null
{
	return value && /^Bearer ([^\s,]+)$/u.test(value) ? /^Bearer ([^\s,]+)$/u.exec(value)?.[1] ?? null : null;
}

/** Keep request coordinates bounded before a database lookup. */
function _Coordinate(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}
