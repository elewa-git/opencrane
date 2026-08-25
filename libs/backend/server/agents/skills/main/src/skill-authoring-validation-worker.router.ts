import { Readable } from "node:stream";

import { Router, type Request, type Response } from "express";

import { __HashSkillWorkloadBootstrapReference, __IsSkillWorkloadBootstrapReference } from "@opencrane/contracts";

import type { SkillAuthoringValidationWorkerCompletion, SkillAuthoringValidationWorkerRouterDependencies } from "./skill-authoring-validation-worker.types";

/** Pins worker identity review to the isolated authoring Job audience. */
const _AUTHORING_AUDIENCE = "opencrane-skill-authoring";
/** Prevents the source broker from opening a candidate archive larger than the worker can safely hold. */
const _MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/**
 * Builds the worker-only API for bootstrap, immutable input, and terminal completion.
 *
 * Every route reviews the projected authoring-Pod token before it reads or changes validation state.
 * A denied identity receives 401, unavailable or stale saved state receives 409 or 404, and the
 * route stores completion evidence before it emits the event that wakes the remote task. Called by:
 * `_CreateSkillAuthoringValidationRuntimeComposition`.
 *
 * @param dependencies - Supplies token review, server authority, artifact streaming, event delivery, and logging.
 * @returns A router mounted below `/api/internal/agent-runtime`.
 */
export function __CreateSkillAuthoringValidationWorkerRouter(dependencies: SkillAuthoringValidationWorkerRouterDependencies): Router
{
	const router = Router();
	router.post("/skill-authoring-validations:bootstrap", async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		const reference = _BootstrapReference(request.body);
		const identity = await _Identity(request, dependencies);
		if (reference === null || identity === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const validationId = await dependencies.authority.consumeBootstrap(await __HashSkillWorkloadBootstrapReference(reference), identity);
			if (validationId === null)
			{
				response.status(409).json({ error: "bootstrap_unavailable" });
				return;
			}
			response.status(200).json({ acknowledged: true, validationId });
		}
		catch (err)
		{
			_Failure(dependencies, err, "skill_authoring_validation.bootstrap");
			response.status(503).json({ error: "bootstrap_authority_unavailable" });
		}
	});
	router.get("/skill-authoring-validations/:validationId/input", async function _Input(request: Request, response: Response): Promise<void>
	{
		const validationId = _Coordinate(request.params["validationId"]);
		const identity = await _Identity(request, dependencies);
		if (validationId === null || identity === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const input = await dependencies.authority.loadInput(validationId, identity);
			if (input === null || input.byteLength > _MAX_ARCHIVE_BYTES)
			{
				response.status(404).json({ error: "authoring_input_unavailable" });
				return;
			}
			const reader = (await dependencies.artifactReader.read(input)).getReader();
			const first = await reader.read();
			response.status(200).set({ "content-type": input.mediaType, "content-length": String(input.byteLength), "x-opencrane-content-address": input.contentAddress, "cache-control": "no-store" });
			const stream = Readable.from(_Bytes(reader, first));
			response.once("close", function _Cancel(): void { void reader.cancel().catch(function _Ignore(): void {}); });
			stream.once("error", function _Abort(err: Error): void { _Failure(dependencies, err, "skill_authoring_validation.input"); response.destroy(err); }).pipe(response);
		}
		catch (err)
		{
			_Failure(dependencies, err, "skill_authoring_validation.input");
			if (!response.headersSent)
			{
				response.status(503).json({ error: "authoring_input_unavailable" });
			}
			else
			{
				response.destroy(err instanceof Error ? err : new Error("authoring input stream failed"));
			}
		}
	});
	router.post("/skill-authoring-validations:complete", async function _Complete(request: Request, response: Response): Promise<void>
	{
		const command = _Completion(request.body);
		const identity = await _Identity(request, dependencies);
		if (command === null || identity === null)
		{
			response.status(401).json({ error: "worker_identity_denied" });
			return;
		}
		try
		{
			const event = await dependencies.authority.complete(command, identity);
			if (event === null)
			{
				response.status(409).json({ error: "completion_unavailable" });
				return;
			}
			await dependencies.emitEvent(event);
			await dependencies.authority.markEventPublished(event);
			response.status(200).json({ completed: true });
		}
		catch (err)
		{
			_Failure(dependencies, err, "skill_authoring_validation.completion");
			response.status(503).json({ error: "completion_authority_unavailable" });
		}
	});
	return router;
}

/** Reads the worker's one bootstrap field and refuses other body fields. */
function _BootstrapReference(value: unknown): string | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	return Object.keys(body).length === 1 && __IsSkillWorkloadBootstrapReference(body["bootstrapReference"]) ? body["bootstrapReference"] : null;
}

/** Reviews the only bearer credential a worker may present to this router. */
async function _Identity(request: Request, dependencies: SkillAuthoringValidationWorkerRouterDependencies)
{
	const token = /^Bearer ([^\s,]+)$/u.exec(request.header("authorization") ?? "")?.[1];
	if (token === undefined)
	{
		return null;
	}
	return await dependencies.tokenReviewer.__Review(token, _AUTHORING_AUDIENCE);
}

/** Reads one bounded opaque validation coordinate. */
function _Coordinate(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

/** Parses the two bounded completion shapes without accepting arbitrary worker JSON. */
function _Completion(value: unknown): SkillAuthoringValidationWorkerCompletion | null
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return null;
	}
	const body = value as Record<string, unknown>;
	const validationId = _Coordinate(body["validationId"]);
	if (validationId === null)
	{
		return null;
	}
	if (body["outcome"] === "failed" && _Keys(body, ["validationId", "outcome", "failureCode"]) && typeof body["failureCode"] === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(body["failureCode"]))
	{
		return { validationId, outcome: "failed", failureCode: body["failureCode"] };
	}
	if (body["outcome"] === "succeeded" && _Keys(body, ["validationId", "outcome", "testReport", "scanResult"]) && _Report(body["testReport"]) && _Report(body["scanResult"]))
	{
		return { validationId, outcome: "succeeded", testReport: body["testReport"], scanResult: body["scanResult"] };
	}
	return null;
}

/** Checks a report's exact fixed fields and scalar limits. */
function _Report(value: unknown): value is { readonly passed: boolean; readonly summary: string; readonly checksRun: number }
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
	{
		return false;
	}
	const report = value as Record<string, unknown>;
	return _Keys(report, ["passed", "summary", "checksRun"]) && typeof report["passed"] === "boolean" && typeof report["summary"] === "string" && report["summary"].length > 0 && report["summary"].length <= 2_000 && !/[\u0000-\u001f\u007f]/.test(report["summary"]) && Number.isSafeInteger(report["checksRun"]) && (report["checksRun"] as number) >= 0 && (report["checksRun"] as number) <= 10_000;
}

/** Compares an object with the exact keys its route permits. */
function _Keys(value: Record<string, unknown>, expected: readonly string[]): boolean
{
	return Object.keys(value).length === expected.length && expected.every(function _Present(key): boolean { return key in value; });
}

/** Streams the already-read source chunk followed by the remaining immutable artifact bytes. */
async function* _Bytes(reader: ReadableStreamDefaultReader<Uint8Array>, first: ReadableStreamReadResult<Uint8Array>): AsyncGenerator<Uint8Array>
{
	if (!first.done)
	{
		yield first.value;
	}
	while (true)
	{
		const next = await reader.read();
		if (next.done)
		{
			return;
		}
		yield next.value;
	}
}

/** Logs one internal worker-route failure without credentials or candidate content. */
function _Failure(dependencies: SkillAuthoringValidationWorkerRouterDependencies, err: unknown, operation: string): void
{
	dependencies.logger.error({ err, operation }, "Skill authoring validation worker request failed");
}
