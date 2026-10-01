import { Router, type Request, type Response } from "express";

import type { ConversationComputerReviewCredentialRouterOptions } from "./conversation-computer-turn.types";
import { _ConversationFailureDiagnostic } from "../../messages/conversation-failure-diagnostic";

/** Build the Pod-authenticated transport that hands out only its lease-derived review secret. */
export function _CreateConversationComputerReviewCredentialRouter(options: ConversationComputerReviewCredentialRouterOptions): Router
{
	const router = Router();
	router.get("/review-credential", async function _ReviewCredential(request: Request, response: Response): Promise<void>
	{
		const command = await _LeaseCommand(request, response, options);
		if (command === null)
			return;
		try
		{
			response.status(200).json(await options.authority.reviewCredential(command));
		}
		catch (error)
		{
			const diagnostic = _ConversationFailureDiagnostic(error);
			options.logger.warn({ operation: "conversation.computer.review_credential", err: diagnostic, errorType: diagnostic.type }, "Conversation computer review credential unavailable");
			response.status(409).json({ error: "conversation_computer_rebootstrap_required" });
		}
	});
	return router;
}

/** TokenReview the caller and read its lease coordinates, answering 401 or 400 when either is missing. */
async function _LeaseCommand(request: Request, response: Response, options: ConversationComputerReviewCredentialRouterOptions)
{
	const workload = await _Workload(request, options);
	const computerId = _String(request.query["computerId"]);
	const leaseId = _String(request.query["leaseId"]);
	const generation = Number(request.query["generation"]);
	if (workload === null)
	{
		response.sendStatus(401);
		return null;
	}
	if (computerId === null || leaseId === null || !Number.isSafeInteger(generation) || generation < 1)
	{
		response.sendStatus(400);
		return null;
	}
	return { computerId, lease: { leaseId, leaseGeneration: generation }, workload };
}

/** TokenReview one bearer credential without exposing denial details. */
async function _Workload(request: Request, options: ConversationComputerReviewCredentialRouterOptions)
{
	const header = request.header("authorization") ?? "";
	if (!header.startsWith("Bearer "))
		return null;
	return options.tokenReviewer.__Review(header.slice("Bearer ".length));
}

/** Accept one non-empty scalar string without normalization. */
function _String(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 && value === value.trim() ? value : null;
}
