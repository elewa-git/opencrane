import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";

import { ___ParticipantInputBlocksSchema } from "@opencrane/models/conversations";

import { _ConversationCreationRequestSchema } from "./validators/conversation-creation.validator";
import { AgentThreadReadDenialReasons, ConversationAuthorityOutcomes, ConversationWriteDenialReasons, type ConversationWriteDenial } from "./types/conversation-authority-result.types";
import type { SelfConversationsRouterDependencies } from "./self-conversations.router.types";

/** Bounded idempotent participant message body. */
const _MessageSchema = z.object({
	idempotencyKey: z.string().trim().min(1).max(128),
	blocks: ___ParticipantInputBlocksSchema,
	agentTarget: z.object({ agentServiceId: z.string().trim().min(1).max(128) }).strict().optional(),
}).strict();

/** Participant-local archive mutation body. */
const _ArchiveSchema = z.object({ archived: z.boolean() }).strict();

/** Exact canonical child position the participant has actually observed. */
const _AgentThreadReadSchema = z.object({ observedPosition: z.string().regex(/^(0|[1-9][0-9]*)$/u).max(19).refine(function _DatabaseBigInt(value) { return BigInt(value) <= 9_223_372_036_854_775_807n; }) }).strict();

/**
 * Body for retrying a run: the attempt the participant was looking at, plus their retry key.
 *
 * `expectedAttempt` is what makes the retry safe rather than optional — `__StartNextRunAttempt` uses
 * it as a compare-and-swap guard, so a stale number is a conflict instead of a second attempt.
 * Rejecting a non-integer or a value below 1 here means the run authority is never asked at all;
 * `_RejectsMalformedRetry` in self-conversations.router.test.ts asserts that. The key bound matches
 * {@link _MessageSchema}; the run authority stores it on the attempt's outbox event and compares it
 * there, which is how a repeated request is recognised as the same retry.
 */
const _RunRetrySchema = z.object({ expectedAttempt: z.number().int().min(1), idempotencyKey: z.string().trim().min(1).max(128) }).strict();

/**
 * Build the HTTP routes a signed-in user uses for their own conversations: read the creation
 * directory, list, create, open, open an Agent thread, mark one read, post a message, retry a run,
 * archive, close.
 *
 * The router owns three jobs and nothing else. It derives the caller from the session (never
 * from the path or body, so there is no route for reading someone else's conversations), checks
 * the request shape, and translates the result: a `Denied` outcome becomes the HTTP status from
 * `_STATUS_BY_DENIAL` with the denial value as the `error` field, while an unexpected throw
 * becomes 503 with a generic code. Authorisation itself happens in the database layer behind
 * `dependencies.authority`.
 *
 * So every route follows the same three steps: 401 when there is no session, 400 when the path
 * parameters or body do not parse, and only then a call into the authority. Nothing below reads a
 * silo, subject, or participant identifier out of the request — a body that tries to supply one is
 * rejected by the strict schemas, which `_RejectsAuthorityCoordinates` in the router test asserts.
 *
 * Called by: `_CreateSelfConversationsRouter` (prisma-self-conversations.router.ts), which is
 * mounted at `/api/v1/me/conversations` by apps/opencrane/src/app/routes.ts.
 *
 * @param dependencies - Caller resolver, the conversation authority port, and the logger.
 * @returns An Express router with the ten participant routes mounted on it.
 * @see _SelfConversationsOpenapiPaths in openapi.ts — the documented contract these routes
 * must match.
 */
export function __CreateSelfConversationsRouter(dependencies: SelfConversationsRouterDependencies): Router
{
	const router = Router();

	// The directory has no request shape to validate and only two answers: 200 with opaque member
	// references, or 503. There is no 404 and no 403 — a caller whose membership has been revoked
	// makes the authority throw, and that lands in the catch below, so being removed from the
	// organisation is indistinguishable from the database being unreachable. This route must be
	// declared before `/:conversationId`, or Express would match "directory" as a conversation id.
	router.get("/directory", async function _Directory(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		try
		{
			response.status(200).json({ directory: await dependencies.authority.directory(caller) });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.directory", caller.siloId);
			response.status(503).json({ error: "conversation_unavailable" });
		}
	});

	router.get("/", async function _List(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		try
		{
			const conversations = await dependencies.authority.list(caller, request.query["includeArchived"] === "true");
			response.status(200).json({ conversations });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.list", caller.siloId);
			response.status(503).json({ error: "conversation_unavailable" });
		}
	});

	router.post("/", async function _Create(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const parsed = _ConversationCreationRequestSchema.safeParse(request.body);
		if (!parsed.success) { response.status(400).json({ error: "invalid_conversation_request" }); return; }
		try
		{
			const result = await dependencies.authority.create(caller, parsed.data);
			if (result.outcome === ConversationAuthorityOutcomes.Denied) { _logUnavailable(dependencies.logger, result.reason, "conversation.create", caller.siloId); response.status(_denialStatus(result.reason)).json({ error: result.reason }); return; }
			response.status(201).json({ conversation: result.conversation });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.create", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.get("/:parentConversationId/agent-threads/:childConversationId", async function _OpenAgentThread(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const parentConversationId = _parameter(request.params["parentConversationId"]);
		const childConversationId = _parameter(request.params["childConversationId"]);
		if (parentConversationId === null || childConversationId === null) { response.status(400).json({ error: "invalid_agent_thread_route" }); return; }
		try
		{
			const agentThread = await dependencies.authority.openAgentThread(caller, parentConversationId, childConversationId);
			if (agentThread === null) { response.status(404).json({ error: "conversation_unavailable" }); return; }
			response.status(200).json({ agentThread });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.agent_thread.open", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.put("/:parentConversationId/agent-threads/:childConversationId/read-through", async function _MarkAgentThreadRead(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const parentConversationId = _parameter(request.params["parentConversationId"]);
		const childConversationId = _parameter(request.params["childConversationId"]);
		const parsed = _AgentThreadReadSchema.safeParse(request.body);
		if (parentConversationId === null || childConversationId === null || !parsed.success) { response.status(400).json({ error: "invalid_agent_thread_read_position" }); return; }
		try
		{
			const result = await dependencies.authority.markAgentThreadRead(caller, parentConversationId, childConversationId, parsed.data.observedPosition);
			if (result.outcome === ConversationAuthorityOutcomes.Denied) { response.status(result.reason === AgentThreadReadDenialReasons.ObservedPositionUnavailable ? 409 : 404).json({ error: result.reason }); return; }
			response.status(200).json(result);
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.agent_thread.mark_read", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.get("/:conversationId", async function _Open(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const conversationId = _parameter(request.params["conversationId"]);
		if (conversationId === null) { response.status(400).json({ error: "invalid_conversation_id" }); return; }
		try
		{
			const conversation = await dependencies.authority.open(caller, conversationId);
			if (conversation === null) { response.status(404).json({ error: "conversation_unavailable" }); return; }
			response.status(200).json({ conversation });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.open", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.post("/:conversationId/messages", async function _SubmitMessage(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const conversationId = _parameter(request.params["conversationId"]);
		const parsed = _MessageSchema.safeParse(request.body);
		if (conversationId === null || !parsed.success) { response.status(400).json({ error: "invalid_conversation_message" }); return; }
		try
		{
			const result = await dependencies.authority.submitMessage(caller, conversationId, parsed.data);
			if (result.outcome === ConversationAuthorityOutcomes.Denied) { _logUnavailable(dependencies.logger, result.reason, "conversation.message.submit", caller.siloId); response.status(_denialStatus(result.reason)).json({ error: result.reason }); return; }
			response.status(result.outcome === ConversationAuthorityOutcomes.Accepted ? 201 : 200).json({ outcome: result.outcome, message: result.message, agentThread: result.agentThread });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.message.submit", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	// Retry is the one write here whose authority lives outside this package: the runs package checks
	// that the caller is still an active member and still a participant, and that the run belongs to
	// the conversation in the path. This route only proves there is a session, that both path
	// parameters and the body parse, and then maps the outcome — 201 for a new attempt, 200 for a
	// replay of the same retry key, and `_runRetryDenialStatus` for a denial. `currentAttempt` is
	// echoed because an attempt conflict is recoverable: the client can re-read the run and retry the
	// attempt that is actually current.
	router.post("/:conversationId/runs/:runId/retry", async function _RetryRun(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const conversationId = _parameter(request.params["conversationId"]);
		const runId = _parameter(request.params["runId"]);
		const parsed = _RunRetrySchema.safeParse(request.body);
		if (conversationId === null || runId === null || !parsed.success) { response.status(400).json({ error: "invalid_run_retry" }); return; }
		try
		{
			const result = await dependencies.authority.retryRun(caller, conversationId, runId, parsed.data);
			if (result.outcome === "started") { response.status(201).json({ outcome: result.outcome, runId: result.run.id, attempt: result.run.attempt }); return; }
			if (result.outcome === "idempotent") { response.status(200).json({ outcome: result.outcome, runId: result.run.id, attempt: result.run.attempt }); return; }
			response.status(_runRetryDenialStatus(result.reason)).json({ error: result.reason, currentAttempt: result.currentAttempt });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.run.retry", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.patch("/:conversationId/archive", async function _Archive(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const conversationId = _parameter(request.params["conversationId"]);
		const parsed = _ArchiveSchema.safeParse(request.body);
		if (conversationId === null || !parsed.success) { response.status(400).json({ error: "invalid_conversation_archive" }); return; }
		try
		{
			const result = await dependencies.authority.setArchived(caller, conversationId, parsed.data.archived);
			if (result.outcome === ConversationAuthorityOutcomes.Denied) { _logUnavailable(dependencies.logger, result.reason, "conversation.archive", caller.siloId); response.status(_denialStatus(result.reason)).json({ error: result.reason }); return; }
			response.status(200).json({ conversation: result.conversation });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.archive", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});

	router.post("/:conversationId/close", async function _Close(request: Request, response: Response)
	{
		const caller = dependencies.resolveCaller(request);
		if (caller === null) { response.status(401).json({ error: "conversation_authentication_required" }); return; }
		const conversationId = _parameter(request.params["conversationId"]);
		if (conversationId === null) { response.status(400).json({ error: "invalid_conversation_id" }); return; }
		try
		{
			const result = await dependencies.authority.close(caller, conversationId);
			if (result.outcome === ConversationAuthorityOutcomes.Denied) { _logUnavailable(dependencies.logger, result.reason, "conversation.close", caller.siloId); response.status(_denialStatus(result.reason)).json({ error: result.reason }); return; }
			response.status(200).json({ conversation: result.conversation });
		}
		catch (err)
		{
			_log(dependencies.logger, err, "conversation.close", caller.siloId);
			response.status(503).json({ error: "persistence_unavailable" });
		}
	});
	return router;
}

/** Reads one exact Express path parameter. */
function _parameter(value: string | readonly string[] | undefined): string | null
{
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Look up the HTTP status for a denial reason. Total by construction, so an unmapped reason cannot fall through to a 200. */
function _denialStatus(reason: ConversationWriteDenial): number
{
	return _STATUS_BY_DENIAL[reason];
}

/**
 * Look up the HTTP status for a retry denial from the runs package.
 *
 * The three groups mean different things to a client. 404 covers `run_not_found` and `unauthorized`
 * together: the run authority answers `unauthorized` when the run exists but sits in another
 * conversation, silo, or belongs to a caller who is no longer a participant, so collapsing the two
 * is what stops this route being used to discover other people's runs. 400 is `invalid_command`,
 * which means the coordinates never made sense. Everything else is 409 — `run_not_terminal`,
 * `attempt_conflict`, `agent_service_inactive`, `agent_service_silo_mismatch`,
 * `agent_revision_superseded` — and all of those say the request was understood but the run's current
 * state refuses it, so the client should re-read the run rather than repeat the call.
 *
 * @param reason - The `reason` from a denied {@link RetryConversationRunResult}.
 * @returns The status to send. Unknown reasons fall to 409, which is the safe default here: a new
 *   refusal reason is reported as a state conflict rather than as success or as a missing run.
 * @see _MapsRetryDenials in self-conversations.router.test.ts, which pins the 404 and 409 cases.
 */
function _runRetryDenialStatus(reason: string): number
{
	if (reason === "run_not_found" || reason === "unauthorized") return 404;
	if (reason === "invalid_command") return 400;
	return 409;
}

/**
 * One HTTP status per denial reason. Typed as a complete record, so adding a member to
 * {@link ConversationWriteDenialReasons} without a status here fails the build rather than
 * shipping a wrong status.
 *
 * Two groupings are deliberate. `ConversationUnavailable`, `ParticipantUnavailable`, and
 * `AgentServiceUnavailable` all answer 404 so a client cannot probe for conversations, users,
 * or agents it may not see. And 429 for `CapacityLimited` is kept apart from 503 for
 * `PersistenceUnavailable`: the first means "we are busy, send the same request again", the
 * second means "we could not confirm the write" — collapsing them would have clients retrying
 * a possibly-applied write as though it were a queue delay.
 */
const _STATUS_BY_DENIAL: Readonly<Record<ConversationWriteDenialReasons, number>> = {
	[ConversationWriteDenialReasons.ConversationUnavailable]: 404,
	[ConversationWriteDenialReasons.ConversationClosed]: 409,
	[ConversationWriteDenialReasons.CommandNotSupported]: 409,
	[ConversationWriteDenialReasons.ActiveRun]: 409,
	[ConversationWriteDenialReasons.IdempotencyConflict]: 409,
	[ConversationWriteDenialReasons.ParticipantUnavailable]: 404,
	[ConversationWriteDenialReasons.AgentServiceUnavailable]: 404,
	[ConversationWriteDenialReasons.CapacityLimited]: 429,
	[ConversationWriteDenialReasons.PersistenceUnavailable]: 503,
};

/** Log an unexpected failure with the operation name and silo only. Message content and the user's identity are deliberately left out. */
function _log(logger: Logger, err: unknown, operation: string, siloId: string): void
{
	logger.error({ err, operation, siloId }, "Conversation operation failed");
}

/** Log a warning only for a database-unavailable denial. Every other denial is a normal client outcome and is not logged. */
function _logUnavailable(logger: Logger, reason: ConversationWriteDenial, operation: string, siloId: string): void
{
	if (reason === ConversationWriteDenialReasons.PersistenceUnavailable) logger.warn({ operation, reason, siloId }, "Conversation operation unavailable");
}
