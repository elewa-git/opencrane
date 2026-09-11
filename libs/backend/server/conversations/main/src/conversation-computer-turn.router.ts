import { Router, type Request, type Response } from "express";

import type { ConversationComputerTurnRouterOptions } from "./conversation-computer-turn.types";
import { _ConversationFailureDiagnostic } from "./conversation-failure-diagnostic";

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Build the Pod-authenticated transport that hands out the review secret, bootstraps turns and requests server-owned model work. */
export function _CreateConversationComputerTurnRouter(options: ConversationComputerTurnRouterOptions): Router
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
	router.get("/bootstrap", async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		const command = await _LeaseCommand(request, response, options);
		if (command === null)
			return;
		let bootstrap;
		try
		{
			bootstrap = await options.authority.bootstrap(command);
		}
		catch (error)
		{
			const diagnostic = _ConversationFailureDiagnostic(error);
			options.logger.warn({ operation: "conversation.computer.bootstrap", err: diagnostic, errorType: diagnostic.type }, "Conversation computer bootstrap unavailable");
			response.status(409).json({ error: "conversation_computer_rebootstrap_required" });
			return;
		}
		if (bootstrap === null)
		{
			response.status(204).end();
			return;
		}
		response.status(200).json(bootstrap);
	});
	router.post("/model-step", async function _ModelStep(request: Request, response: Response): Promise<void>
	{
		const process = await _Process(request, options);
		if (process === null)
		{
			response.sendStatus(401);
			return;
		}
		const body = request.body as Record<string, unknown>;
		const bootstrapId = _String(body?.["bootstrapId"]);
		if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || bootstrapId === null || !_UUID.test(bootstrapId))
		{
			response.sendStatus(400);
			return;
		}
		try
		{
			response.status(200).json(await options.authority.modelStep({ bootstrapId, process }));
		}
		catch (error)
		{
			const diagnostic = _ConversationFailureDiagnostic(error);
			options.logger.warn({ operation: "conversation.computer.model_step", err: diagnostic, errorType: diagnostic.type }, "Conversation computer model step unavailable");
			response.status(409).json({ error: "conversation_computer_rebootstrap_required" });
		}
	});
	return router;
}

/** TokenReview the caller and read its lease coordinates, answering 401 or 400 when either is missing. */
async function _LeaseCommand(request: Request, response: Response, options: ConversationComputerTurnRouterOptions)
{
	const process = await _Process(request, options);
	const computerId = _String(request.query["computerId"]);
	const leaseId = _String(request.query["leaseId"]);
	const generation = Number(request.query["generation"]);
	if (process === null)
	{
		response.sendStatus(401);
		return null;
	}
	if (computerId === null || leaseId === null || !Number.isSafeInteger(generation) || generation < 1)
	{
		response.sendStatus(400);
		return null;
	}
	return { computerId, lease: { leaseId, leaseGeneration: generation }, process };
}

/** Authenticate one process bearer without exposing denial details. */
async function _Process(request: Request, options: ConversationComputerTurnRouterOptions)
{
	const header = request.header("authorization") ?? "";
	if (!header.startsWith("Bearer "))
		return null;
	return options.authenticator.authenticate(header.slice("Bearer ".length));
}

/** Accept one non-empty scalar string without normalization. */
function _String(value: unknown): string | null
{
	return typeof value === "string" && value.length > 0 && value === value.trim() ? value : null;
}
