import { Router, type Request, type Response } from "express";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { RoutineFiringReasons, ___RoutineControlRequestSchema, ___RoutineCreateRequestSchema, ___RoutineIdentifierSchema, ___RoutineReviseRequestSchema, type RoutineDefinitionResponse, type RoutineDetailsResponse, type RoutineFiringResponse } from "@opencrane/contracts";

import type { RoutineCaller, RoutineCommandResult, RoutineFiringResult, RoutineProjection } from "../routine-authority.types";
import { RoutineCommandConflictError, RoutineCommandUnavailableError, RoutineCommandValidationError } from "../routine-command.errors";
import type { RoutineHttpAuthority, RoutineHttpLogger, RoutineRequestPrincipalResolver } from "./routine-http.types";

/** Public reason values keyed by the corresponding private stored reason. */
const _PUBLIC_FIRING_REASONS = new Map<string, RoutineFiringReasons>([
	[RoutineFiringReasons.RoutineRetired, RoutineFiringReasons.RoutineRetired],
	[RoutineFiringReasons.CurrentAuthorityOrAudienceRefused, RoutineFiringReasons.CurrentAuthorityOrAudienceRefused],
	[RoutineFiringReasons.UnfinishedFiring, RoutineFiringReasons.UnfinishedFiring],
]);

/** Creates the authenticated routine command and read router. */
export function __CreateRoutineRouter(authority: RoutineHttpAuthority, logger: RoutineHttpLogger, resolvePrincipal: RoutineRequestPrincipalResolver = _ResolveRequestPrincipal): Router
{
	const router = Router();
	router.use(function _DisableCaching(_request, response, next): void
	{
		response.set("Cache-Control", "no-store");
		next();
	});

	router.post("/", async function _Create(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const parsed = ___RoutineCreateRequestSchema.safeParse(request.body);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.create({ caller, ...parsed.data });
			response.status(201).json({ routine: _Definition(result) });
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.get("/:routineId", async function _Read(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const routineId = _RoutineId(request);
		if (routineId === null)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.read({ caller, routineId });
			if (result === null)
				return void response.status(404).json({ error: "routine_unavailable" });
			response.json({ routine: _Details(result) });
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.post("/:routineId/revise", async function _Revise(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const routineId = _RoutineId(request);
		const parsed = ___RoutineReviseRequestSchema.safeParse(request.body);
		if (routineId === null || !parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.revise({ caller, routineId, ...parsed.data });
			response.json({ routine: _Definition(result) });
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.post("/:routineId/pause", async function _Pause(request, response)
	{
		await _Control(request, response, authority.pause.bind(authority), logger, resolvePrincipal);
	});

	router.post("/:routineId/resume", async function _Resume(request, response)
	{
		await _Control(request, response, authority.resume.bind(authority), logger, resolvePrincipal);
	});

	router.post("/:routineId/retire", async function _Retire(request, response)
	{
		await _Control(request, response, authority.retire.bind(authority), logger, resolvePrincipal);
	});

	router.post("/:routineId/run-now", async function _RunNow(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const routineId = _RoutineId(request);
		const parsed = ___RoutineControlRequestSchema.safeParse(request.body);
		if (routineId === null || !parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.runNow({ caller, routineId, ...parsed.data });
			response.json({ firing: _Firing(result) });
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	return router;
}

/** Executes one lifecycle command after applying the shared caller and payload checks. */
async function _Control(request: Request, response: Response, operation: (command: { readonly caller: RoutineCaller; readonly routineId: string; readonly expectedLifecycleRevision: number; readonly idempotencyKey: string }) => Promise<RoutineCommandResult>, logger: RoutineHttpLogger, resolvePrincipal: RoutineRequestPrincipalResolver): Promise<void>
{
	const caller = _Caller(request, resolvePrincipal);
	if (caller === null)
		return void response.status(401).json({ error: "routine_authentication_required" });
	const routineId = _RoutineId(request);
	const parsed = ___RoutineControlRequestSchema.safeParse(request.body);
	if (routineId === null || !parsed.success)
		return void response.status(400).json({ error: "invalid_routine_command" });
	try
	{
		const result = await operation({ caller, routineId, ...parsed.data });
		response.json({ routine: _Definition(result) });
	}
	catch (error)
	{
		_RespondError(response, logger, caller, error);
	}
}

/** Maps authenticated request facts into the scheduling domain caller. */
function _Caller(request: Request, resolvePrincipal: RoutineRequestPrincipalResolver): RoutineCaller | null
{
	const principal = resolvePrincipal(request);
	if (principal === null || principal.verifiedAuthenticationAt === null || !Number.isFinite(principal.verifiedAuthenticationAt.getTime()))
		return null;
	return { siloId: principal.siloId, principalId: principal.principalId, issuer: principal.externalIssuer, subjectId: principal.externalSubject, authenticatedAt: principal.verifiedAuthenticationAt.toISOString() };
}

/** Parses the path identifier through the shared public contract. */
function _RoutineId(request: Request): string | null
{
	const result = ___RoutineIdentifierSchema.safeParse(request.params["routineId"]);
	return result.success ? result.data : null;
}

/** Projects a command result without its internal replay outcome. */
function _Definition(result: RoutineCommandResult): RoutineDefinitionResponse
{
	return { routineId: result.routineId, currentRevision: result.currentRevision, status: result.status, lifecycleRevision: result.lifecycleRevision, nextAutomaticOccurrence: result.nextAutomaticOccurrence };
}

/** Projects an authorized read without requester identity or ciphertext coordinates. */
function _Details(result: RoutineProjection): RoutineDetailsResponse
{
	return { ..._Definition(result), destinationConversationId: result.destinationConversationId, selectedManagedServiceId: result.selectedManagedServiceId, schedule: result.schedule, audiencePrincipalIds: result.audiencePrincipalIds, instruction: result.instruction };
}

/** Projects a firing only when its stored reason belongs to the closed public contract. */
function _Firing(result: RoutineFiringResult): RoutineFiringResponse
{
	let reason: RoutineFiringReasons | null = null;
	if (result.reason !== null)
	{
		reason = _PUBLIC_FIRING_REASONS.get(result.reason) ?? null;
		if (reason === null)
			throw new Error("routine firing result contains a non-public reason");
	}
	return { firingId: result.firingId, routineId: result.routineId, routineRevision: result.routineRevision, trigger: result.trigger, disposition: result.disposition, conversationId: result.conversationId, scheduledSlot: result.scheduledSlot, reason };
}

/** Maps expected domain errors and hides every other failure from the caller and logs. */
function _RespondError(response: Response, logger: RoutineHttpLogger, caller: RoutineCaller, error: unknown): void
{
	if (error instanceof RoutineCommandValidationError)
		return void response.status(400).json({ error: "invalid_routine_command" });
	if (error instanceof RoutineCommandUnavailableError)
		return void response.status(404).json({ error: "routine_unavailable" });
	if (error instanceof RoutineCommandConflictError)
		return void response.status(409).json({ error: "routine_conflict" });
	logger.warn({ err: new Error("Routine API dependency failed"), siloId: caller.siloId }, "Routine API unavailable");
	response.status(503).json({ error: "routine_service_unavailable" });
}
