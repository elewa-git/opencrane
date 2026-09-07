import { Router, type Request } from "express";
import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";

import { ConversationMessageActivations, ConversationMessageAdmissionOutcomes, type ConversationMessageCommand, type SelfConversationHistoryDiagnosticError, type SelfConversationHistoryRouterDependencies } from "./self-conversation-history.types";
import { _CreateSelfConversationEventsHandler } from "./self-conversation-events";

/** UUID syntax accepted for browser message retry keys. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Nonnegative decimal cursor accepted without normalization ambiguity. */
const _POSITION_PATTERN = /^(0|[1-9][0-9]*)$/;
/** Recognizes Prisma's documented error classes across its CommonJS and ESM runtime copies. */
const _PRISMA_ERROR_TYPES = ["PrismaClientValidationError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientRustPanicError"] as const;

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
			const diagnostic = _DiagnosticError(error);
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
			const diagnostic = _DiagnosticError(error);
			dependencies.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: caller.siloId, principalId: caller.principalId }, "Conversation message post unavailable");
			response.status(503).json({ error: "conversation_history_unavailable" });
		}
	});
}

/** Copies recognized diagnostic codes while leaving error text, causes, names, and metadata behind. */
function _DiagnosticError(error: unknown): SelfConversationHistoryDiagnosticError
{
	const type = _ErrorType(error);
	const diagnostic = { type, message: "Conversation history operation failed" };
	if (!(error instanceof Error))
		return diagnostic;
	const codeProperty = type === "PrismaClientInitializationError" ? "errorCode" : "code";
	const code: unknown = Object.getOwnPropertyDescriptor(error, codeProperty)?.value;
	if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 599)
		return { ...diagnostic, code };
	if (typeof code === "string" && (/^P[0-9]{4}$/.test(code) || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)))
		return { ...diagnostic, code };
	return diagnostic;
}

/** Selects an allowlisted Prisma name or standard JavaScript class without copying arbitrary text. */
function _ErrorType(error: unknown): string
{
	if (!(error instanceof Error))
		return "unknown";
	const name: unknown = Object.getOwnPropertyDescriptor(error, "name")?.value;
	const prismaType = _PRISMA_ERROR_TYPES.find(knownType => knownType === name);
	if (prismaType !== undefined)
		return prismaType;
	if (error instanceof TypeError)
		return "TypeError";
	if (error instanceof RangeError)
		return "RangeError";
	if (error instanceof SyntaxError)
		return "SyntaxError";
	return "Error";
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
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const body = value as Record<string, unknown>;
	if (Object.keys(body).some(key => !["idempotencyKey", "text", "activation"].includes(key)))
		return null;
	if (typeof body["idempotencyKey"] !== "string" || !_UUID_PATTERN.test(body["idempotencyKey"]))
		return null;
	if (typeof body["text"] !== "string" || body["text"].length === 0 || Buffer.byteLength(body["text"], "utf8") > 65_536)
		return null;
	if (!Object.values(ConversationMessageActivations).includes(body["activation"] as ConversationMessageActivations))
		return null;
	return { idempotencyKey: body["idempotencyKey"], text: body["text"], activation: body["activation"] as ConversationMessageActivations };
}

/** Narrows an Express path parameter without selecting among repeated coordinates. */
function _PathIdentifier(value: string | readonly string[] | undefined): string
{
	return typeof value === "string" ? value : "";
}
