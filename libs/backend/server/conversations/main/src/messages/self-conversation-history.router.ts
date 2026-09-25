import { Router, type Request } from "express";
import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";

import { ConversationMessageAdmissionOutcomes, type ConversationMessageCommand, type SelfConversationHistoryRouterDependencies } from "./self-conversation-history.types";
import { _ParseConversationMessageCommand } from "./conversation-message-admission.validator";
import { _ConversationFailureDiagnostic } from "./conversation-failure-diagnostic";
import { _CreateSelfConversationEventsHandler } from "./self-conversation-events";

/** Nonnegative decimal cursor accepted without normalization ambiguity. */
const _POSITION_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Creates the authenticated participant KurrentDB history and message router. */
export function _CreateSelfConversationHistoryRouter(dependencies: SelfConversationHistoryRouterDependencies): Router
{
	const router = Router();
	if (dependencies.events !== undefined)
		router.get("/:conversationId/events", _CreateSelfConversationEventsHandler({ ...dependencies.events, authority: dependencies.authority, resolveCaller: dependencies.resolveCaller }));
	router.get("/:conversationId/history", function _Read(request, response) { void _HandleRead(request, response, dependencies); });
	router.post("/:conversationId/messages", function _Post(request, response) { void _HandlePost(request, response, dependencies); });
	return router;
}

/** Resolves identity and returns one exclusive-cursor history page. */
async function _HandleRead(request: Request, response: import("express").Response, dependencies: SelfConversationHistoryRouterDependencies): Promise<void>
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null)
	{
		response.status(401).json({ error: "unauthorized" });
		return;
	}
	const afterPosition = _AfterPosition(request.query["afterPosition"]);
	if (afterPosition === null)
	{
		response.status(400).json({ error: "invalid_cursor" });
		return;
	}
	await ___DoWithTrace("conversation.history.read", { siloId: caller.siloId, principalId: caller.principalId }, async function _ReadHistory()
	{
		try
		{
			const result = await dependencies.authority.read(caller, _PathIdentifier(request.params["conversationId"]), afterPosition);
			if (result === null)
			{
				response.status(404).json({ error: "conversation_unavailable" });
				return;
			}
			response.status(200).json(result);
		}
		catch (error)
		{
			___MarkActiveSpanFailed();
			const diagnostic = _ConversationFailureDiagnostic(error);
			dependencies.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: caller.siloId, principalId: caller.principalId }, "Conversation history read unavailable");
			response.status(503).json({ error: "conversation_history_unavailable" });
		}
	});
}

/** Resolves identity, validates one bounded plaintext command, and returns its immutable position. */
async function _HandlePost(request: Request, response: import("express").Response, dependencies: SelfConversationHistoryRouterDependencies): Promise<void>
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null)
	{
		response.status(401).json({ error: "unauthorized" });
		return;
	}
	const command = _MessageCommand(request.body);
	if (command === null)
	{
		response.status(400).json({ error: "invalid_request" });
		return;
	}
	await ___DoWithTrace("conversation.message.post", { siloId: caller.siloId, principalId: caller.principalId }, async function _PostMessage()
	{
		try
		{
			const result = await dependencies.authority.postMessage(caller, _PathIdentifier(request.params["conversationId"]), command);
			if (result === null)
			{
				response.status(404).json({ error: "conversation_unavailable" });
				return;
			}
			response.status(result.outcome === ConversationMessageAdmissionOutcomes.Accepted ? 202 : 200).json(result);
		}
		catch (error)
		{
			const message = error instanceof Error ? error.message : "";
			if (message.includes("idempotency") || message.includes("cannot activate"))
			{
				response.status(409).json({ error: "message_conflict" });
				return;
			}
			___MarkActiveSpanFailed();
			const diagnostic = _ConversationFailureDiagnostic(error);
			dependencies.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: caller.siloId, principalId: caller.principalId }, "Conversation message post unavailable");
			response.status(503).json({ error: "conversation_history_unavailable" });
		}
	});
}

/** Parses an optional exclusive decimal cursor and distinguishes omission from malformed input. */
function _AfterPosition(value: unknown): bigint | undefined | null
{
	if (value === undefined)
		return undefined;
	if (typeof value !== "string" || !_POSITION_PATTERN.test(value))
		return null;
	try
	{
		return BigInt(value);
	}
	catch
	{
		return null;
	}
}

/** Validates the closed participant message body without retaining extra browser fields. */
function _MessageCommand(value: unknown): ConversationMessageCommand | null
{
	return _ParseConversationMessageCommand(value);
}

/** Narrows an Express path parameter without selecting among repeated coordinates. */
function _PathIdentifier(value: string | readonly string[] | undefined): string
{
	return typeof value === "string" ? value : "";
}
