import { Router } from "express";
import type { ConversationCallerResolver } from "./self-conversation-history.types";
import type { ConversationMetadataAuthority } from "./conversation-metadata.types";

/** Creates projection-only directory, list, detail, create, archive, and close routes. */
export function _CreateConversationMetadataRouter(authority: ConversationMetadataAuthority, resolveCaller: ConversationCallerResolver): Router
{
	const router = Router();
	router.get("/directory", function _Directory(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { response.json({ directory: await authority.directory(caller) }); }); });
	router.get("/", function _List(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { response.json({ conversations: await authority.list(caller, request.query["includeArchived"] === "true") }); }); });
	router.get("/:conversationId", function _Open(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { _Respond(response, await authority.open(caller, _Id(request.params["conversationId"])), 200); }); });
	router.post("/", function _Create(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { _Respond(response, await authority.create(caller, request.body), 201); }); });
	router.patch("/:conversationId/archive", function _Archive(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { await _ArchiveConversation(request, response, authority, caller); }); });
	router.post("/:conversationId/close", function _Close(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { _Respond(response, await authority.close(caller, _Id(request.params["conversationId"])), 200); }); });
	return router;
}

/** Applies trusted caller resolution and one bounded unavailable response. */
async function _Handle(request: import("express").Request, response: import("express").Response, resolveCaller: ConversationCallerResolver, work: (caller: NonNullable<ReturnType<ConversationCallerResolver>>) => Promise<void>): Promise<void>
{
	const caller = resolveCaller(request);
	if (caller === null)
	{
		response.status(401).json({ error: "unauthorized" });
		return;
	}
	try { await work(caller); }
	catch { response.status(503).json({ error: "conversation_authority_unavailable" }); }
}

/** Validates and applies one archive state change. */
async function _ArchiveConversation(request: import("express").Request, response: import("express").Response, authority: ConversationMetadataAuthority, caller: NonNullable<ReturnType<ConversationCallerResolver>>): Promise<void>
{
	if (typeof request.body?.archived !== "boolean")
	{
		response.status(400).json({ error: "invalid_request" });
		return;
	}
	_Respond(response, await authority.archive(caller, _Id(request.params["conversationId"]), request.body.archived), 200);
}

/** Maps one nullable metadata result to its bounded HTTP response. */
function _Respond(response: import("express").Response, conversation: Awaited<ReturnType<ConversationMetadataAuthority["open"]>>, successStatus: number): void
{
	if (conversation === null)
	{
		response.status(404).json({ error: "conversation_unavailable" });
		return;
	}
	response.status(successStatus).json({ conversation });
}
/** Narrows one non-repeated Express path coordinate. */
function _Id(value: string | readonly string[] | undefined): string { return typeof value === "string" ? value : ""; }
