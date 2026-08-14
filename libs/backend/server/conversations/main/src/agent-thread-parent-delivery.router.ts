import { Router, type Request } from "express";
import { z } from "zod";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";

import type { AgentThreadParentDeliveryRouterDependencies, DeliverAgentThreadParentResult } from "./agent-thread-parent-delivery.types";

const _Body = z.object({ runId: z.string().trim().min(1).max(128), childConversationId: z.string().trim().min(1).max(128), idempotencyKey: z.string().trim().min(1).max(128), kind: z.nativeEnum(AgentThreadDeliveryKinds), label: z.string().trim().min(1).max(160), detail: z.string().trim().min(1).max(4000), assetId: z.string().trim().min(1).max(128).nullable().default(null) }).strict();

/** Private TokenReview-authenticated producer for display-safe immediate-parent deliveries. */
export function __CreateAgentThreadParentDeliveryRouter(dependencies: AgentThreadParentDeliveryRouterDependencies): Router
{
	const router = Router();
	router.post("/agent-threads/parent-deliveries", async function _Deliver(request, response)
	{
		try
		{
			const identity = await _Identity(request, dependencies);
			if (identity === null) { response.status(401).json({ outcome: "denied", reason: "authority_unavailable" }); return; }
			const parsed = _Body.safeParse(request.body);
			if (!parsed.success) { response.status(400).json({ outcome: "denied", reason: "invalid_display_content" }); return; }
			const result = await dependencies.authority.deliver(identity, parsed.data);
			response.status(_Status(result)).json(result);
		}
		catch (err)
		{
			dependencies.logger.error({ err }, "Agent-thread delivery transport failed");
			response.status(503).json({ outcome: "denied", reason: "persistence_unavailable" });
		}
	});
	return router;
}

/** Map complete stable authority outcomes to transport status without weakening narrowing. */
function _Status(result: DeliverAgentThreadParentResult): number
{
	if (result.outcome !== "denied") return result.outcome === "accepted" ? 201 : 200;
	switch (result.reason)
	{
		case "invalid_display_content": return 400;
		case "idempotency_conflict": return 409;
		case "persistence_unavailable": return 503;
		case "authority_unavailable": return 403;
	}
}

async function _Identity(request: Request, dependencies: AgentThreadParentDeliveryRouterDependencies)
{
	const authorization = request.headers.authorization;
	if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || authorization.length <= 7) return null;
	return dependencies.tokenReviewer.__Review(authorization.slice(7));
}
