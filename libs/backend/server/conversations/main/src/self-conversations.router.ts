import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";

import { ___ConversationCreationRequestSchema, ___ParticipantInputBlocksSchema } from "@opencrane/models/conversations";

import { AgentThreadReadDenialReasons, ConversationAuthorityOutcomes, ConversationWriteDenialReasons, type ConversationWriteDenial } from "./conversation-authority.types.js";
import type { SelfConversationsRouterDependencies } from "./self-conversations.router.types.js";

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
 * Build the HTTP routes a signed-in user uses for their own conversations: list, create, open,
 * post a message, archive, close.
 *
 * The router owns three jobs and nothing else. It derives the caller from the session (never
 * from the path or body, so there is no route for reading someone else's conversations), checks
 * the request shape, and translates the result: a `Denied` outcome becomes the HTTP status from
 * `_STATUS_BY_DENIAL` with the denial value as the `error` field, while an unexpected throw
 * becomes 503 with a generic code. Authorisation itself happens in the database layer behind
 * `dependencies.authority`.
 *
 * Called by: `_CreateSelfConversationsRouter` (prisma-self-conversations.router.ts), which is
 * mounted at `/api/v1/me/conversations` by apps/opencrane/src/app/routes.ts.
 *
 * @param dependencies - Caller resolver, the conversation authority port, and the logger.
 * @returns An Express router with the six participant routes mounted on it.
 * @see _SelfConversationsOpenapiPaths in openapi.ts — the documented contract these routes
 * must match.
 */
export function __CreateSelfConversationsRouter(dependencies: SelfConversationsRouterDependencies): Router
{
	const router = Router();
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
		const parsed = ___ConversationCreationRequestSchema.safeParse(request.body);
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
