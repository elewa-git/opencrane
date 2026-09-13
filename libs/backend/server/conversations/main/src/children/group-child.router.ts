import { Router, type Request, type Response } from "express";
import type { Logger } from "@opencrane/backend/observability";

import { GroupChildConflictError } from "./group-child.errors";
import type { GroupChildAuthority } from "./group-child.types";
import { _ParseGroupChildCreate, _ParseGroupChildShare } from "./group-child.validator";
import { ConversationMessageAdmissionOutcomes, type ConversationCallerResolver } from "../messages/self-conversation-history.types";
import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Creates explicit child admission and human-reviewed return routes under the participant API. */
export function _CreateGroupChildRouter(authority: GroupChildAuthority, resolveCaller: ConversationCallerResolver, logger: Pick<Logger, "warn">): Router
{
	const router = Router();
	router.post("/:conversationId/children", function _Create(request, response)
	{
		void _Handle(request, response, resolveCaller, logger, async function _Run(caller)
		{
			const command = _ParseGroupChildCreate(request.body);
			if (command === null)
				return void response.status(400).json({ error: "invalid_request" });
			const child = await authority.create(caller, _Id(request), command);
			if (child === null)
				return _Unavailable(response);
			response.status(202).json({ child });
		});
	});
	router.get("/:conversationId/children", function _List(request, response)
	{
		void _Handle(request, response, resolveCaller, logger, async function _Run(caller)
		{
			const children = await authority.list(caller, _Id(request));
			if (children === null)
				return _Unavailable(response);
			response.json({ children });
		});
	});
	router.post("/:conversationId/share", function _Share(request, response)
	{
		void _Handle(request, response, resolveCaller, logger, async function _Run(caller)
		{
			const command = _ParseGroupChildShare(request.body);
			if (command === null)
				return void response.status(400).json({ error: "invalid_request" });
			const receipt = await authority.share(caller, _Id(request), command);
			if (receipt === null)
				return _Unavailable(response);
			response.status(receipt.outcome === ConversationMessageAdmissionOutcomes.Accepted ? 202 : 200).json(receipt);
		});
	});
	return router;
}

/** Applies verified caller resolution and fixed failures without disclosing child existence. */
async function _Handle(request: Request, response: Response, resolveCaller: ConversationCallerResolver, logger: Pick<Logger, "warn">, operation: (caller: ConversationCaller) => Promise<void>): Promise<void>
{
	response.set("Cache-Control", "no-store");
	const caller = resolveCaller(request);
	if (caller === null)
		return void response.status(401).json({ error: "unauthorized" });
	try { await operation(caller); }
	catch (error)
	{
		if (error instanceof GroupChildConflictError)
			return void response.status(409).json({ error: "group_child_command_conflict" });
		logger.warn({ err: new Error("Group child operation failed"), siloId: caller.siloId }, "Group child operation unavailable");
		response.status(503).json({ error: "conversation_authority_unavailable" });
	}
}

/** Returns the same response for absent, foreign and currently inaccessible conversations. */
function _Unavailable(response: Response): void { response.status(404).json({ error: "conversation_unavailable" }); }

/** Rejects a repeated route coordinate instead of selecting an arbitrary value. */
function _Id(request: Request): string { return typeof request.params["conversationId"] === "string" ? request.params["conversationId"] : ""; }
