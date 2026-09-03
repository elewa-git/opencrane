import { Router, type Request, type Response } from "express";

import type { ConversationComputerRuntimeBootstrapResponse, ConversationComputerRuntimeBootstrapRouterDependencies, ConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-bootstrap.router.types";

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
export function __CreateConversationComputerRuntimeBootstrapRouter(dependencies: ConversationComputerRuntimeBootstrapRouterDependencies): Router
{
	const router = Router();
	router.post("/bootstrap", async function _Bootstrap(request: Request, response: Response)
	{
		// 1. Review the projected token before inspecting caller-controlled body content.
		const identity = await _ReviewIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Accept one computer identifier, then derive every execution coordinate from history.
		const computerId = _ReadComputerId(request.body);
		if (computerId === null)
		{
			response.status(400).json({ error: "invalid_runtime_bootstrap" });
			return;
		}
		let active;
		try
		{
			active = await dependencies.history.loadActiveExecutionForBootstrap({ siloId: dependencies.siloId, computerId, nowEpochMilliseconds: dependencies.clock.now().getTime() });
		}
		catch (err)
		{
			dependencies.logger.warn({ err }, "ConversationComputer runtime bootstrap history was unavailable or inactive");
			response.status(403).json({ error: "runtime_denied" });
			return;
		}

		// 3. Bind the reviewed Pod identity to the Pod identity persisted with the active lease.
		if (!_MatchesLeaseRuntimePod(identity, active.lease.runtimePod))
		{
			response.status(403).json({ error: "runtime_denied" });
			return;
		}
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

/** Review the caller identity and hide TokenReview transport failures from a runtime caller. */
async function _ReviewIdentity(request: Request, response: Response, dependencies: ConversationComputerRuntimeBootstrapRouterDependencies): Promise<ConversationComputerRuntimeIdentity | null>
{
	const token = _ReadBearer(request.header("authorization"));
	if (token === null)
	{
		response.status(401).json({ error: "runtime_denied" });
		return null;
	}
	try
	{
		const identity = await dependencies.tokenReviewer.__Review(token);
		if (identity === null)
			response.status(401).json({ error: "runtime_denied" });
		return identity;
	}
	catch (err)
	{
		dependencies.logger.error({ err }, "ConversationComputer runtime TokenReview failed");
		response.status(503).json({ error: "runtime_unavailable" });
		return null;
	}
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

/** Read one bearer token without accepting a token list or a scheme variation. */
function _ReadBearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}

/** Compare every Kubernetes identity field so a replacement Pod cannot reuse a former lease. */
function _MatchesLeaseRuntimePod(identity: ConversationComputerRuntimeIdentity, runtimePod: { readonly namespace: string; readonly serviceAccountName: string; readonly podUid: string } | null): boolean
{
	return runtimePod !== null && identity.namespace === runtimePod.namespace && identity.serviceAccountName === runtimePod.serviceAccountName && identity.podUid === runtimePod.podUid;
}
