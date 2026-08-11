import { Router, type Request, type Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";

import { ___ConversationCreationRequestSchema, ___ParticipantInputBlocksSchema } from "@opencrane/models/conversations";

import { ConversationAuthorityOutcomes, ConversationWriteDenialReasons, type ConversationWriteDenial } from "./conversation-authority.types.js";
import type { SelfConversationsRouterDependencies } from "./self-conversations.router.types.js";

/** Bounded idempotent participant message body. */
const _MessageSchema = z.object({ idempotencyKey: z.string().trim().min(1).max(128), blocks: ___ParticipantInputBlocksSchema }).strict();

/** Participant-local archive mutation body. */
const _ArchiveSchema = z.object({ archived: z.boolean() }).strict();

/** Creates the browser-session-authenticated conversation router. */
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
			response.status(result.outcome === ConversationAuthorityOutcomes.Accepted ? 201 : 200).json({ outcome: result.outcome, message: result.message });
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

/** Maps stable authority denials to non-disclosing HTTP classes. */
function _denialStatus(reason: ConversationWriteDenial): number
{
	return _STATUS_BY_DENIAL[reason];
}

/** Exhaustive HTTP mapping that keeps capacity refusal distinct from persistence failure. */
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

/** Emits only bounded operation and silo metadata; body content and identity remain excluded. */
function _log(logger: Logger, err: unknown, operation: string, siloId: string): void
{
	logger.error({ err, operation, siloId }, "Conversation operation failed");
}

/** Records handled persistence degradation without logging message content or participant identity. */
function _logUnavailable(logger: Logger, reason: ConversationWriteDenial, operation: string, siloId: string): void
{
	if (reason === ConversationWriteDenialReasons.PersistenceUnavailable) logger.warn({ operation, reason, siloId }, "Conversation operation unavailable");
}
