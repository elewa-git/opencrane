import { Router } from "express";
import type { ConversationCallerResolver } from "./self-conversation-history.types";
import type { ConversationMetadataAuthority } from "./conversation-metadata.types";

/** Creates projection-only directory, list, detail, create, archive, and close routes. */
export function _CreateConversationMetadataRouter(authority: ConversationMetadataAuthority, resolveCaller: ConversationCallerResolver): Router
{
	const router = Router();
	router.get("/directory", function _Directory(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { response.json({ directory: await authority.directory(caller) }); }); });
	router.get("/", function _List(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { response.json({ conversations: await authority.list(caller, request.query["includeArchived"] === "true") }); }); });
	router.get("/:conversationId", function _Open(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { const conversation = await authority.open(caller, _Id(request.params["conversationId"])); response.status(conversation === null ? 404 : 200).json(conversation === null ? { error: "conversation_unavailable" } : { conversation }); }); });
	router.post("/", function _Create(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { const conversation = await authority.create(caller, request.body); response.status(conversation === null ? 404 : 201).json(conversation === null ? { error: "conversation_unavailable" } : { conversation }); }); });
	router.patch("/:conversationId/archive", function _Archive(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { if (typeof request.body?.archived !== "boolean") { response.status(400).json({ error: "invalid_request" }); return; } const conversation = await authority.archive(caller, _Id(request.params["conversationId"]), request.body.archived); response.status(conversation === null ? 404 : 200).json(conversation === null ? { error: "conversation_unavailable" } : { conversation }); }); });
	router.post("/:conversationId/close", function _Close(request, response) { void _Handle(request, response, resolveCaller, async function _Run(caller) { const conversation = await authority.close(caller, _Id(request.params["conversationId"])); response.status(conversation === null ? 404 : 200).json(conversation === null ? { error: "conversation_unavailable" } : { conversation }); }); });
	return router;
}

/** Applies trusted caller resolution and one bounded unavailable response. */
async function _Handle(request: import("express").Request, response: import("express").Response, resolveCaller: ConversationCallerResolver, work: (caller: NonNullable<ReturnType<ConversationCallerResolver>>) => Promise<void>): Promise<void> { const caller = resolveCaller(request); if (caller === null) { response.status(401).json({ error: "unauthorized" }); return; } try { await work(caller); } catch { response.status(503).json({ error: "conversation_authority_unavailable" }); } }
/** Narrows one non-repeated Express path coordinate. */
function _Id(value: string | readonly string[] | undefined): string { return typeof value === "string" ? value : ""; }
