import { Injectable, inject } from "@angular/core";
import type { z } from "zod";

import { ControlPlaneApiService } from "@opencrane/core";
import { ___RoutineCreationOptionsSchema, ___RoutineDefinitionResponseSchema, ___RoutineDetailsResponseSchema, ___RoutineFiringPageSchema, ___RoutineFiringResponseSchema, ___RoutineListPageSchema, ___RoutineSchedulePreviewSchema, RoutineGatewayError, RoutineGatewayErrorKinds, type RoutineControlCommand, type RoutineCreateCommand, type RoutineDefinition, type RoutineDetails, type RoutineFiring, type RoutineFiringPage, type RoutineFiringQuery, type RoutineGateway, type RoutineListPage, type RoutineListQuery, type RoutineReviseCommand, type RoutineSchedule, type RoutineSchedulePreview } from "@opencrane/state/routines";

type RoutineApiResult = { readonly data?: unknown; readonly response: Pick<Response, "status">; readonly error?: unknown };

/** Delays client invocation until the abort coordinate has passed its preflight check. */
type RoutineApiRequest = () => Promise<RoutineApiResult>;

/** Adapts the signed-in generated client to the routine state port without caching or policy. */
@Injectable()
export class OpenCraneRoutineGateway implements RoutineGateway
{
	/** Core client carries the session cookie and server no-store contract. */
	private readonly _api = inject(ControlPlaneApiService);

	/** Reads one routine page. */
	public async list(query?: RoutineListQuery, signal?: AbortSignal): Promise<RoutineListPage>
	{
		return await this._Read(() => this._api.client.GET("/me/routines", { params: { query }, signal }), 200, ___RoutineListPageSchema, signal);
	}

	/** Reads one routine detail projection. */
	public async read(routineId: string, signal?: AbortSignal): Promise<RoutineDetails>
	{
		const result = await this._Read(() => this._api.client.GET("/me/routines/{routineId}", { params: { path: { routineId } }, signal }), 200, ___RoutineDetailsResponseSchema, signal);
		this._AssertIdentity(result.routine.routineId, routineId);
		return result.routine;
	}

	/** Reads one routine firing-history page. */
	public async firings(routineId: string, query?: RoutineFiringQuery, signal?: AbortSignal): Promise<RoutineFiringPage>
	{
		return await this._Read(() => this._api.client.GET("/me/routines/{routineId}/firings", { params: { path: { routineId }, query }, signal }), 200, ___RoutineFiringPageSchema, signal);
	}

	/** Reads choices for one destination conversation. */
	public async creationOptions(destinationConversationId: string, signal?: AbortSignal)
	{
		const result = await this._Read(() => this._api.client.GET("/me/routines/creation-options", { params: { query: { destinationConversationId } }, signal }), 200, ___RoutineCreationOptionsSchema, signal);
		this._AssertIdentity(result.destinationConversationId, destinationConversationId);
		return result;
	}

	/** Calculates five upcoming occurrences without saving a routine. */
	public async preview(schedule: RoutineSchedule, signal?: AbortSignal): Promise<RoutineSchedulePreview>
	{
		return await this._Read(() => this._api.client.POST("/me/routines/schedule-preview", { body: { schedule }, signal }), 200, ___RoutineSchedulePreviewSchema, signal);
	}

	/** Creates one reviewed routine. */
	public async create(command: RoutineCreateCommand, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		const result = await this._Read(() => this._api.client.POST("/me/routines", { body: command, signal }), 201, ___RoutineDefinitionResponseSchema, signal);
		return result.routine;
	}

	/** Adds one immutable revision. */
	public async revise(routineId: string, command: RoutineReviseCommand, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		return await this._DefinitionCommand(routineId, () => this._api.client.POST("/me/routines/{routineId}/revise", { params: { path: { routineId } }, body: command, signal }), signal);
	}

	/** Pauses automatic firing. */
	public async pause(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		return await this._DefinitionCommand(routineId, () => this._api.client.POST("/me/routines/{routineId}/pause", { params: { path: { routineId } }, body: command, signal }), signal);
	}

	/** Resumes automatic firing. */
	public async resume(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		return await this._DefinitionCommand(routineId, () => this._api.client.POST("/me/routines/{routineId}/resume", { params: { path: { routineId } }, body: command, signal }), signal);
	}

	/** Retires a routine permanently. */
	public async retire(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		return await this._DefinitionCommand(routineId, () => this._api.client.POST("/me/routines/{routineId}/retire", { params: { path: { routineId } }, body: command, signal }), signal);
	}

	/** Requests one immediate firing. */
	public async runNow(routineId: string, command: RoutineControlCommand, signal?: AbortSignal): Promise<RoutineFiring>
	{
		const result = await this._Read(() => this._api.client.POST("/me/routines/{routineId}/run-now", { params: { path: { routineId } }, body: command, signal }), 200, ___RoutineFiringResponseSchema, signal);
		this._AssertIdentity(result.firing.routineId, routineId);
		return result.firing;
	}

	/** Sends a lifecycle command and adopts its validated definition. */
	private async _DefinitionCommand(routineId: string, request: RoutineApiRequest, signal?: AbortSignal): Promise<RoutineDefinition>
	{
		const result = await this._Read(request, 200, ___RoutineDefinitionResponseSchema, signal);
		this._AssertIdentity(result.routine.routineId, routineId);
		return result.routine;
	}

	/** Validates status, body and abort state without exposing server error prose. */
	private async _Read<Value>(request: RoutineApiRequest, expectedStatus: number, schema: z.ZodType<Value>, signal?: AbortSignal): Promise<Value>
	{
		try
		{
			this._assertAborted(signal);
			const result = await request();
			this._assertAborted(signal);
			if (result.response.status !== expectedStatus)
				throw _StatusError(result.response.status);
			if (result.data === undefined)
				throw new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidResponse);
			const parsed = schema.safeParse(result.data);
			if (!parsed.success)
				throw new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidResponse);
			return parsed.data;
		}
		catch (error)
		{
			this._assertAborted(signal);
			if (error instanceof RoutineGatewayError)
				throw error;
			throw new RoutineGatewayError(RoutineGatewayErrorKinds.Unknown);
		}
	}

	/** Rejects a successful response whose resource identity differs from the request. */
	private _AssertIdentity(actual: string, expected: string): void
	{
		if (actual !== expected)
			throw new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidResponse);
	}

	/** Prevents a late response from reaching state after cancellation. */
	private _assertAborted(signal?: AbortSignal): void
	{
		if (signal?.aborted)
			throw new DOMException("Routine request cancelled.", "AbortError");
	}
}

/** Maps only the public HTTP status categories to browser-safe errors. */
function _StatusError(status: number): RoutineGatewayError
{
	if (status === 400)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.InvalidRequest);
	if (status === 401)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.Unauthenticated);
	if (status === 403)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.AccessDenied);
	if (status === 404)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.NotFound);
	if (status === 409)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.Conflict);
	if (status === 503)
		return new RoutineGatewayError(RoutineGatewayErrorKinds.Unavailable);
	return new RoutineGatewayError(RoutineGatewayErrorKinds.Unknown);
}
