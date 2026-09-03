import { Router, type Request, type Response } from "express";

import { _AdmitConversationComputerRuntime, _ReviewConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-admission";
import type { ConversationComputerRuntimeOutputRouterDependencies } from "./conversation-computer-runtime-output.router.types";

/** Recognizes the command UUID supplied by the Sandbox for one server-issued command. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Bounds text retained by the private-payload store and accepted by the route parser. */
const _MAXIMUM_TEXT_BYTES = 64 * 1_024;

/**
 * Builds the Sandbox-only output route for an active ConversationComputer execution.
 *
 * The route accepts just a computer id, command id, and bounded text. It derives every execution,
 * identity, and conversation coordinate after Pod admission before delegating to the authority.
 */
export function __CreateConversationComputerRuntimeOutputRouter(dependencies: ConversationComputerRuntimeOutputRouterDependencies): Router
{
	const router = Router();
	router.post("/output", async function _RecordOutput(request: Request, response: Response)
	{
		// 1. Review the projected identity before parsing any caller-selected output coordinates.
		const identity = await _ReviewConversationComputerRuntimeIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Accept only command-owned text; all execution and author coordinates stay server-derived.
		const output = _ReadOutput(request.body);
		if (output === null)
		{
			response.status(400).json({ error: "invalid_runtime_output" });
			return;
		}

		// 3. Resolve the active lease only after authentication and strict input validation.
		const admission = await _AdmitConversationComputerRuntime(output.computerId, identity, response, dependencies);
		if (admission === null)
			return;

		// 4. Pass immutable active coordinates to the authority, which atomically fences and publishes.
		try
		{
			const command = {
				siloId: dependencies.siloId,
				computerId: admission.active.computer.id,
				conversationId: admission.active.computer.conversationId,
				executionId: admission.active.execution.id,
				leaseGeneration: admission.active.lease.generation,
				profileRevisionId: admission.active.computer.profileRevisionId,
				commandId: output.commandId,
				text: output.text,
			};
			const result = await dependencies.authority.record(command);
			response.status(200).json({ messageId: result.messageId });
		}
		catch (err)
		{
			dependencies.logger.warn({ err }, "ConversationComputer runtime output was denied");
			response.status(403).json({ error: "runtime_denied" });
		}
	});
	return router;
}

/** Reads one strict runtime output without admitting execution, lease, author, or payload coordinates. */
function _ReadOutput(value: unknown): { readonly computerId: string; readonly commandId: string; readonly text: string } | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const output = value as Record<string, unknown>;
	const keys = ["computerId", "commandId", "text"];
	if (Object.keys(output).length !== keys.length || !keys.every(key => Object.hasOwn(output, key)))
		return null;
	if (typeof output.computerId !== "string" || typeof output.commandId !== "string" || typeof output.text !== "string")
		return null;
	const computerId = output.computerId.trim();
	const text = output.text;
	if (computerId.length === 0 || computerId.length > 128 || !_UUID_PATTERN.test(output.commandId) || text.trim().length === 0 || Buffer.byteLength(text, "utf8") > _MAXIMUM_TEXT_BYTES)
		return null;
	return { computerId, commandId: output.commandId, text };
}
