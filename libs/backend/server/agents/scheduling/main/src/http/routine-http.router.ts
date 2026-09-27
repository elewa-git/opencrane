import { Router, type Request, type Response } from "express";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { RoutineFiringReasons, ___RoutineControlRequestSchema, ___RoutineCreateRequestSchema, ___RoutineCreationOptionsQuerySchema, ___RoutineFiringListQuerySchema, ___RoutineIdentifierSchema, ___RoutineListQuerySchema, ___RoutineReviseRequestSchema, ___RoutineSchedulePreviewRequestSchema, type RoutineCreationOptionsResponse, type RoutineDefinitionResponse, type RoutineDetailsResponse, type RoutineFiringListResponse, type RoutineFiringResponse, type RoutineListResponse, type RoutineSchedulePreviewResponse } from "@opencrane/contracts";

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

	router.get("/", async function _List(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const parsed = ___RoutineListQuerySchema.safeParse(request.query);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.list({ caller, ..._ReadQuery(parsed.data) });
			response.send(_ProjectList(result));
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.get("/creation-options", async function _CreationOptions(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const parsed = ___RoutineCreationOptionsQuerySchema.safeParse(request.query);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.creationOptions({ caller, ...parsed.data });
			response.send(_ProjectCreationOptions(result));
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.post("/schedule-preview", async function _Preview(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const parsed = ___RoutineSchedulePreviewRequestSchema.safeParse(request.body);
		if (!parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.preview({ caller, ...parsed.data });
			response.send(_ProjectPreview(result));
		}
		catch (error)
		{
			_RespondError(response, logger, caller, error);
		}
	});

	router.get("/:routineId/firings", async function _Firings(request, response)
	{
		const caller = _Caller(request, resolvePrincipal);
		if (caller === null)
			return void response.status(401).json({ error: "routine_authentication_required" });
		const routineId = _RoutineId(request);
		const parsed = ___RoutineFiringListQuerySchema.safeParse(request.query);
		if (routineId === null || !parsed.success)
			return void response.status(400).json({ error: "invalid_routine_command" });
		try
		{
			const result = await authority.firings({ caller, routineId, ..._ReadQuery(parsed.data) });
			response.send(_ProjectFirings(result));
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

/** Copies only the bounded pagination controls into an authority query. */
function _ReadQuery(query: { readonly limit: number; readonly cursor?: string }): { readonly limit: number; readonly cursor?: string }
{
	return query.cursor === undefined ? { limit: query.limit } : { limit: query.limit, cursor: query.cursor };
}

/** Projects the routine page through the public field allowlist. */
function _ProjectList(result: RoutineListResponse): RoutineListResponse
{
	const page = { items: result.items.map(function _ProjectListItem(item)
	{
		return { routineId: item.routineId, currentRevision: item.currentRevision, status: item.status, lifecycleRevision: item.lifecycleRevision, ownership: item.ownership, destinationConversationId: item.destinationConversationId, selectedManagedService: { managedServiceId: item.selectedManagedService.managedServiceId, displayName: item.selectedManagedService.displayName }, schedule: item.schedule, lastAutomaticOccurrence: item.lastAutomaticOccurrence, nextAutomaticOccurrence: item.nextAutomaticOccurrence, lastFiring: _ProjectLastFiring(item.lastFiring), capabilities: { revise: item.capabilities.revise, pause: item.capabilities.pause, resume: item.capabilities.resume, retire: item.capabilities.retire, runNow: item.capabilities.runNow } };
	}), limit: result.limit };
	return _WithCursor(page, result.nextCursor);
}

/** Projects firing history without exposing task, requester, run or refusal internals. */
function _ProjectFirings(result: RoutineFiringListResponse): RoutineFiringListResponse
{
	const page = { items: result.items.map(function _ProjectFiring(item)
	{
		return { firingId: item.firingId, routineRevision: item.routineRevision, trigger: item.trigger, disposition: item.disposition, scheduledSlot: item.scheduledSlot, createdAt: item.createdAt, finishedAt: item.finishedAt, reason: item.reason, runTerminalReason: item.runTerminalReason, resultConversationId: item.resultConversationId, actualCost: item.actualCost === null ? null : { amount: item.actualCost.amount, currency: item.actualCost.currency } };
	}), limit: result.limit };
	return _WithCursor(page, result.nextCursor);
}

/** Projects one optional firing summary. */
function _ProjectLastFiring(item: RoutineListResponse["items"][number]["lastFiring"]): RoutineListResponse["items"][number]["lastFiring"]
{
	if (item === null)
		return null;
	return { firingId: item.firingId, routineRevision: item.routineRevision, trigger: item.trigger, disposition: item.disposition, scheduledSlot: item.scheduledSlot, finishedAt: item.finishedAt };
}

/** Preserves continuation only when the authority supplied one. */
function _WithCursor<T extends { readonly items: readonly unknown[]; readonly limit: number }>(page: T, cursor: string | undefined): T & { readonly nextCursor?: string }
{
	if (cursor === undefined)
		return page;
	return { ...page, nextCursor: cursor };
}

/** Projects creation choices while retaining only safe labels and references. */
function _ProjectCreationOptions(result: RoutineCreationOptionsResponse): RoutineCreationOptionsResponse
{
	return { destinationConversationId: result.destinationConversationId, audienceChoices: result.audienceChoices.map(choice => ({ participantRef: choice.participantRef, displayName: choice.displayName, isSelf: choice.isSelf })), managedServiceChoices: result.managedServiceChoices.map(choice => ({ managedServiceId: choice.managedServiceId, displayName: choice.displayName })) };
}

/** Projects exactly five calculated occurrences and the normalized schedule. */
function _ProjectPreview(result: RoutineSchedulePreviewResponse): RoutineSchedulePreviewResponse
{
	return { schedule: result.schedule, calculatedAt: result.calculatedAt, nextOccurrences: result.nextOccurrences };
}

/** Projects a command result without its internal replay outcome. */
function _Definition(result: RoutineCommandResult): RoutineDefinitionResponse
{
	return { routineId: result.routineId, currentRevision: result.currentRevision, status: result.status, lifecycleRevision: result.lifecycleRevision, nextAutomaticOccurrence: result.nextAutomaticOccurrence };
}

/** Projects an authorized read without requester identity or ciphertext coordinates. */
function _Details(result: RoutineProjection): RoutineDetailsResponse
{
	return { routineId: result.routineId, currentRevision: result.currentRevision, status: result.status, lifecycleRevision: result.lifecycleRevision, ownership: result.ownership, destinationConversationId: result.destinationConversationId, selectedManagedService: { managedServiceId: result.selectedManagedService.managedServiceId, displayName: result.selectedManagedService.displayName }, schedule: result.schedule, lastAutomaticOccurrence: result.lastAutomaticOccurrence, nextAutomaticOccurrence: result.nextAutomaticOccurrence, lastFiring: result.lastFiring, capabilities: { revise: result.capabilities.revise, pause: result.capabilities.pause, resume: result.capabilities.resume, retire: result.capabilities.retire, runNow: result.capabilities.runNow }, audienceParticipantRefs: result.audienceParticipantRefs, audienceChoices: result.audienceChoices.map(choice => ({ participantRef: choice.participantRef, displayName: choice.displayName, isSelf: choice.isSelf })), instruction: result.instruction };
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
	return { firingId: result.firingId, routineId: result.routineId, routineRevision: result.routineRevision, trigger: result.trigger, disposition: result.disposition, scheduledSlot: result.scheduledSlot, reason };
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
