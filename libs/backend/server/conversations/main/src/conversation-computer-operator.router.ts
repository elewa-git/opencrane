import { Router } from "express";

import type { ConversationComputerOperatorPrincipalResolver, ConversationComputerOperatorRouterOptions } from "./conversation-computer-operator.router.types";

/**
 * Mounts the operator-only conversation-computer repair API.
 *
 * `POST /activations/parked:replay` moves the silo's parked activation deliveries back into live
 * delivery after an operator has repaired their cause. The silo comes from the trusted request
 * host and the action is admitted by the central Organization/Administer grant, so no request field
 * can select another silo's queue.
 *
 * Called by: `_RegisterRoutes` in `apps/opencrane/src/app/routes.ts` when computer history is configured.
 *
 * @param options - Supplies authorization, the replay action, and structured failure logging.
 * @param resolvePrincipal - Resolves identity from the authenticated Express request.
 * @returns An Express router whose responses are never cached.
 */
export function _CreateConversationComputerOperatorRouter(options: ConversationComputerOperatorRouterOptions, resolvePrincipal: ConversationComputerOperatorPrincipalResolver): Router
{
	const router = Router();
	router.post("/activations/parked:replay", async function _ReplayParked(request, response)
	{
		const principal = resolvePrincipal(request);
		if (principal === null)
		{
			response.status(401).json({ error: "unauthorized" });
			return;
		}
		const caller = { principalId: principal.principalId, siloId: principal.siloId };
		try
		{
			if (!await options.authorization.admitReplayParkedActivations(caller))
			{
				response.status(403).json({ error: "operator_permission_required" });
				return;
			}
			await options.activations.replayParked(caller.siloId);
			response.status(202).set("cache-control", "no-store").json({ outcome: "replay_requested" });
		}
		catch (err)
		{
			options.logger.warn({ err, siloId: caller.siloId }, "Conversation computer parked activation replay failed");
			response.status(503).json({ error: "conversation_computer_activation_queue_unavailable" });
		}
	});
	return router;
}
