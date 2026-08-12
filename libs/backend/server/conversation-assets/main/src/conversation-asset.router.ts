import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Router, type Request } from "express";

import { ConversationAssetDisposition } from "@opencrane/models/conversation-assets";

import type { ConversationAssetContent } from "./conversation-asset-content.types.js";
import { ConversationAssetDenialReasons } from "./conversation-asset.types.js";
import type { ConversationAssetRouterDependencies } from "./conversation-asset.router.types.js";
import { _ParseReserveConversationAsset } from "./conversation-asset.validator.js";

/** Create the authenticated browser upload and Files-index router. */
export function __CreateConversationAssetRouter(dependencies: ConversationAssetRouterDependencies): Router
{
	const router = Router();
	router.get("/:conversationId/assets", function _List(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { response.status(200).json({ assets: await dependencies.authority.list(caller, request.params["conversationId"] ?? "") }); }); });
	router.get("/:conversationId/assets/:assetId/content", function _Read(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const content = await dependencies.authority.read(caller, request.params["conversationId"] ?? "", request.params["assetId"] ?? ""); if (content === null) return response.status(404).json({ error: "asset_unavailable" }); _SetContentHeaders(response, content); await pipeline(Readable.from(content.bytes), response); }); });
	router.post("/:conversationId/assets", function _Reserve(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const input = _ParseReserveConversationAsset(request.body); if (input === null) return response.status(400).json({ error: "invalid_request" }); const result = await dependencies.authority.reserveUpload(caller, request.params["conversationId"] ?? "", input); response.status(_ReservationStatus(result)).json(result); }); });
	router.put("/:conversationId/assets/:assetId/content", function _Upload(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const result = await dependencies.authority.upload(caller, request.params["conversationId"] ?? "", request.params["assetId"] ?? "", request as AsyncIterable<Uint8Array>); response.status(_UploadStatus(result)).json(result); }); });
	router.delete("/:conversationId/assets/:assetId", function _Remove(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const result = await dependencies.authority.remove(caller, request.params["conversationId"] ?? "", request.params["assetId"] ?? ""); response.status(_RemoveStatus(result.outcome)).json(result); }); });
	return router;
}

/** Set browser-safe response headers without exposing a storage redirect or lease. */
function _SetContentHeaders(response: import("express").Response, content: ConversationAssetContent): void
{
	const disposition = content.disposition === ConversationAssetDisposition.Preview ? "inline" : "attachment";
	response.status(200).set({
		"content-type": content.mediaType,
		"content-length": String(content.byteLength),
		"content-disposition": `${disposition}; filename*=UTF-8''${_EncodeHeaderFilename(content.displayName)}`,
		"cache-control": "private, no-store",
		"x-content-type-options": "nosniff"
	});
}

/**
 * Encode a UTF-8 filename using the attr-char subset accepted in one response header.
 * @see https://www.rfc-editor.org/rfc/rfc8187.html#section-3.2.1
 */
function _EncodeHeaderFilename(value: string): string
{
	let encoded = "";
	for (const byte of Buffer.from(value, "utf8"))
	{
		const character = String.fromCharCode(byte);
		encoded += _IsHeaderAttributeCharacter(byte) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return encoded;
}

/** Return whether one ASCII byte is safe in an RFC 8187 encoded filename. */
function _IsHeaderAttributeCharacter(byte: number): boolean
{
	return byte >= 0x41 && byte <= 0x5a
		|| byte >= 0x61 && byte <= 0x7a
		|| byte >= 0x30 && byte <= 0x39
		|| [0x21, 0x23, 0x24, 0x26, 0x2b, 0x2d, 0x2e, 0x5e, 0x5f, 0x60, 0x7c, 0x7e].includes(byte);
}

/** Map upload outcomes to stable HTTP statuses. */
function _UploadStatus(result: Awaited<ReturnType<ConversationAssetRouterDependencies["authority"]["upload"]>>): number
{
	switch (result.outcome)
	{
		case "accepted":
		case "idempotent": return 202;
		case "denied": return result.reason === ConversationAssetDenialReasons.ScannerUnavailable ? 503 : 409;
	}
}

/** Map reservation outcomes to stable HTTP statuses. */
function _ReservationStatus(result: Awaited<ReturnType<ConversationAssetRouterDependencies["authority"]["reserveUpload"]>>): number
{
	switch (result.outcome)
	{
		case "accepted": return 201;
		case "idempotent": return 200;
		case "denied": return result.reason === ConversationAssetDenialReasons.ScannerUnavailable ? 503 : 409;
	}
}

/** Map removal outcomes to stable HTTP statuses. */
function _RemoveStatus(outcome: "accepted" | "idempotent" | "denied"): number
{
	switch (outcome)
	{
		case "accepted":
		case "idempotent": return 200;
		case "denied": return 409;
	}
}

/** Apply authenticated participant context and a stable failure envelope. */
async function _Handle(request: Request, response: import("express").Response, dependencies: ConversationAssetRouterDependencies, work: (caller: NonNullable<ReturnType<ConversationAssetRouterDependencies["resolveCaller"]>>) => Promise<unknown>): Promise<void>
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null) { response.status(401).json({ error: "unauthorized" }); return; }
	try { await work(caller); }
	catch (err) { dependencies.logger.error({ err }, "conversation asset request failed"); if (!response.headersSent) response.status(503).json({ error: "temporarily_unavailable" }); else response.destroy(); }
}
