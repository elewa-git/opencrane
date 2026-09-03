import { Router, type Request, type Response } from "express";

import { _AdmitConversationComputerRuntime, _ReviewConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-admission";
import type { ConversationComputerRuntimeAdmissionDependencies } from "./conversation-computer-runtime-admission.types";
import type { ConversationComputerRuntimeBootstrapResponse } from "./conversation-computer-runtime-bootstrap.router.types";

/**
 * Build the internal bootstrap route for one ConversationComputer Sandbox.
 *
 * A Sandbox supplies only its computer identifier. The route reviews its projected token, derives
 * the active execution from checked history, and then compares the reviewed Pod identity with the
 * immutable Pod identity recorded on that active lease. This prevents a Sandbox from selecting a
 * different conversation, execution, ServiceAccount, or replaced Pod.
 *
 * Called by: apps/opencrane/src/app/runtime-composition.ts.
 *
 * @param dependencies - Trusted history, TokenReview, silo, clock, and structured logger bindings.
 * @returns An Express router with `POST /bootstrap`.
 */
export function __CreateConversationComputerRuntimeBootstrapRouter(dependencies: ConversationComputerRuntimeAdmissionDependencies): Router
{
	const router = Router();
	router.post("/bootstrap", async function _Bootstrap(request: Request, response: Response)
	{
		// 1. Review the projected token before inspecting caller-controlled body content.
		const identity = await _ReviewConversationComputerRuntimeIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Accept one computer identifier, then derive every execution coordinate from history.
		const computerId = _ReadComputerId(request.body);
		if (computerId === null)
		{
			response.status(400).json({ error: "invalid_runtime_bootstrap" });
			return;
		}
		// 3. Bind the reviewed Pod identity to the Pod identity persisted with the active lease.
		const admission = await _AdmitConversationComputerRuntime(computerId, identity, response, dependencies);
		if (admission === null)
			return;
		const active = admission.active;
		const responseBody: ConversationComputerRuntimeBootstrapResponse = {
			computerId: active.computer.id,
			conversationId: active.computer.conversationId,
			executionId: active.execution.id,
			leaseGeneration: active.lease.generation,
		};
		response.status(200).json(responseBody);
	});
	return router;
}

/** Read one strict bootstrap body without allowing a Sandbox to add durable execution coordinates. */
function _ReadComputerId(value: unknown): string | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const keys = Object.keys(value);
	if (keys.length !== 1 || keys[0] !== "computerId")
		return null;
	const computerId = (value as { readonly computerId?: unknown }).computerId;
	if (typeof computerId !== "string")
		return null;
	const trimmed = computerId.trim();
	return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
