import { Router, type Request } from "express";

import { ConversationAssetOutputDenialReasons, ConversationAssetOutputPublishOutcomes, ConversationAssetOutputReservationOutcomes, type ConversationAssetOutputRouterDependencies } from "./conversation-asset-output.types";
import { _ParseReserveConversationAssetOutput } from "./conversation-asset-output.validator";

/** Create the private TokenReview-authenticated generated-output transport. */
export function __CreateConversationAssetOutputRouter(dependencies: ConversationAssetOutputRouterDependencies): Router
{
	const router = Router();
	router.post("/conversation-assets/outputs:reserve", async function _Reserve(request, response)
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null) { response.status(401).json({ outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.RuntimeUnavailable }); return; }
			const command = _ParseReserveConversationAssetOutput(request.body);
			if (command === null) { response.status(400).json({ outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.InvalidRequest }); return; }
			const result = await dependencies.authority.reserve(identity, command);
			response.status(_ReservationStatus(result)).json(result);
		}
		catch (err)
		{
			dependencies.logger.error({ err }, "Conversation asset output reservation failed");
			response.status(503).json({ outcome: ConversationAssetOutputReservationOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.RuntimeUnavailable });
		}
	});
	router.put("/conversation-assets/outputs/:ticketId/content", async function _Publish(request, response)
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null) { response.status(401).json({ outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.RuntimeUnavailable }); return; }
			if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/octet-stream") { response.status(415).json({ outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.UploadFailed }); return; }
			const result = await dependencies.authority.publish(identity, request.params["ticketId"] ?? "", request);
			response.status(_PublishStatus(result)).json(result);
		}
		catch (err)
		{
			dependencies.logger.error({ err }, "Conversation asset output publication failed");
			response.status(503).json({ outcome: ConversationAssetOutputPublishOutcomes.Denied, reason: ConversationAssetOutputDenialReasons.UploadFailed });
		}
	});
	return router;
}

/** Map generated-output reservation outcomes to stable private transport status codes. */
function _ReservationStatus(result: Awaited<ReturnType<ConversationAssetOutputRouterDependencies["authority"]["reserve"]>>): number
{
	if (result.outcome === ConversationAssetOutputReservationOutcomes.Issued) return 201;
	if (result.outcome === ConversationAssetOutputReservationOutcomes.Idempotent) return 200;
	if (result.reason === ConversationAssetOutputDenialReasons.ScannerUnavailable) return 503;
	return result.reason === ConversationAssetOutputDenialReasons.OutputConflict ? 409 : 400;
}

/** Map generated-output publication outcomes to stable private transport status codes. */
function _PublishStatus(result: Awaited<ReturnType<ConversationAssetOutputRouterDependencies["authority"]["publish"]>>): number
{
	if (result.outcome === ConversationAssetOutputPublishOutcomes.Accepted) return 202;
	if (result.outcome === ConversationAssetOutputPublishOutcomes.Idempotent) return 200;
	if (result.reason === ConversationAssetOutputDenialReasons.ScannerUnavailable) return 503;
	if (result.reason === ConversationAssetOutputDenialReasons.RuntimeUnavailable) return 401;
	return result.reason === ConversationAssetOutputDenialReasons.UploadFailed ? 422 : 409;
}

/** TokenReview one bearer credential without retaining or logging it. */
async function _Identity(request: Request, dependencies: ConversationAssetOutputRouterDependencies)
{
	const authorization = request.headers.authorization;
	if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length <= 7) return null;
	return dependencies.tokenReviewer.__Review(authorization.slice(7));
}
