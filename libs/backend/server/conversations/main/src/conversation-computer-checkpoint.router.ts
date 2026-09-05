import { Router, type Request, type Response } from "express";

import type { ConversationComputerCheckpointRouterOptions } from "./conversation-computer-checkpoint.router.types";

/** Build the Pod-authenticated private endpoint that restores a current computer checkpoint. */
export function _CreateConversationComputerCheckpointRouter(options: ConversationComputerCheckpointRouterOptions): Router
{
	const router = Router();
	router.post("/restore", async function _Restore(request: Request, response: Response): Promise<void>
	{
		const token = _Bearer(request.headers.authorization);
		if (token === null)
		{
			response.sendStatus(401);
			return;
		}
		const workload = await options.tokenReviewer.__Review(token);
		if (workload === null)
		{
			response.sendStatus(401);
			return;
		}
		const command = _Command(request.body, options.siloId, workload.podUid);
		if (command === null)
		{
			response.status(400).json({ error: "invalid_checkpoint_restore_command" });
			return;
		}
		const restored = await options.authority.restore(command);
		if (restored === null)
		{
			response.sendStatus(204);
			return;
		}
		response.status(200).json(restored);
	});
	return router;
}

/** Parse one strict restore command while fixing silo and Pod identity outside request authority. */
function _Command(value: unknown, siloId: string, podUid: string)
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const body = value as Record<string, unknown>;
	const keys = ["computerId", "generation", "leaseId"];
	if (Object.keys(body).sort().join("\u0000") !== [...keys].sort().join("\u0000") || !keys.filter(function _NotGeneration(key) { return key !== "generation"; }).every((key) => typeof body[key] === "string" && body[key] !== "") || !Number.isSafeInteger(body.generation) || Number(body.generation) <= 0)
		return null;
	return { siloId, computerId: body.computerId as string, generation: body.generation as number, leaseId: body.leaseId as string, podUid };
}

/** Read one strict bearer value without accepting another authorization scheme. */
function _Bearer(header: string | undefined): string | null
{
	if (header === undefined || !header.startsWith("Bearer "))
		return null;
	const token = header.slice(7);
	return token && !token.includes(" ") ? token : null;
}
