import { Router, type Request } from "express";

import type { ConversationAssetRouterDependencies } from "./conversation-asset.router.types.js";
import { _ParseReserveConversationAsset } from "./conversation-asset.validator.js";

/** Create the authenticated browser upload and Files-index router. */
export function __CreateConversationAssetRouter(dependencies: ConversationAssetRouterDependencies): Router
{
	const router = Router();
	router.get("/:conversationId/assets", function _List(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { response.status(200).json({ assets: await dependencies.authority.list(caller, request.params["conversationId"] ?? "") }); }); });
	router.post("/:conversationId/assets", function _Reserve(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const input = _ParseReserveConversationAsset(request.body); if (input === null) return response.status(400).json({ error: "invalid_request" }); const result = await dependencies.authority.reserveUpload(caller, request.params["conversationId"] ?? "", input); response.status(_ReservationStatus(result.outcome)).json(result); }); });
	router.put("/:conversationId/assets/:assetId/content", function _Upload(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const result = await dependencies.authority.upload(caller, request.params["conversationId"] ?? "", request.params["assetId"] ?? "", request as AsyncIterable<Uint8Array>); response.status(_UploadStatus(result.outcome)).json(result); }); });
	router.delete("/:conversationId/assets/:assetId", function _Remove(request, response) { void _Handle(request, response, dependencies, async function _Work(caller) { const result = await dependencies.authority.remove(caller, request.params["conversationId"] ?? "", request.params["assetId"] ?? ""); response.status(_RemoveStatus(result.outcome)).json(result); }); });
	return router;
}

/** Map upload outcomes to stable HTTP statuses. */
function _UploadStatus(outcome: "accepted" | "idempotent" | "denied"): number
{
	return outcome === "denied" ? 409 : 202;
}

/** Map reservation outcomes to stable HTTP statuses. */
function _ReservationStatus(outcome: "accepted" | "idempotent" | "denied"): number
{
	if (outcome === "accepted") return 201;
	if (outcome === "idempotent") return 200;
	return 409;
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
