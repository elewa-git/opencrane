import { Router, type Request, type Response } from "express";

import type { ConversationComputerTurnRouterOptions } from "./conversation-computer-turn.types";

const _UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Build the Pod-authenticated transport that bootstraps turns and submits untrusted model output. */
export function _CreateConversationComputerTurnRouter(options: ConversationComputerTurnRouterOptions): Router
{
	const router = Router();
	router.get("/bootstrap", async function _Bootstrap(request: Request, response: Response): Promise<void>
	{
		const workload = await _Workload(request, options);
		const computerId = _String(request.query["computerId"]);
		const leaseId = _String(request.query["leaseId"]);
		const generation = Number(request.query["generation"]);
		if (workload === null)
		{
			response.sendStatus(401);
			return;
		}
		if (computerId === null || leaseId === null || !Number.isSafeInteger(generation) || generation < 1)
		{
			response.sendStatus(400);
			return;
		}
		let bootstrap;
		try
		{
			bootstrap = await options.authority.bootstrap({ computerId, leaseId, generation, workload });
		}
		catch
		{
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
	router.post("/output", async function _Output(request: Request, response: Response): Promise<void>
	{
		const workload = await _Workload(request, options);
		const body = request.body as Record<string, unknown>;
		const bootstrapId = _String(body?.["bootstrapId"]);
		const sourceCommandId = _String(body?.["sourceCommandId"]);
		const text = _String(body?.["text"]);
		if (workload === null)
		{
			response.sendStatus(401);
			return;
		}
		if (bootstrapId === null || sourceCommandId === null || !_UUID.test(sourceCommandId) || text === null || Buffer.byteLength(text, "utf8") > 65_536)
		{
			response.sendStatus(400);
			return;
		}
		let outcome;
		try
		{
			outcome = await options.authority.appendOutput({ bootstrapId, sourceCommandId, text, workload });
		}
		catch
		{
			response.status(409).json({ error: "conversation_computer_rebootstrap_required" });
			return;
		}
		response.status(outcome === "accepted" ? 202 : 200).json({ outcome });
	});
	return router;
}

/** TokenReview one bearer credential without exposing denial details. */
async function _Workload(request: Request, options: ConversationComputerTurnRouterOptions)
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
