import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeTerminalStates, type ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import { Router, type Request, type Response } from "express";

import type { ConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-bootstrap.router.types";
import type { ConversationComputerRuntimeCommandRouterDependencies } from "./conversation-computer-runtime-command.router.types";

/** Builds the Sandbox-only command route for one active ConversationComputer execution. */
export function __CreateConversationComputerRuntimeCommandRouter(dependencies: ConversationComputerRuntimeCommandRouterDependencies): Router
{
	const router = Router();
	router.get("/commands/next", async function _Next(request: Request, response: Response)
	{
		// 1. Review the projected identity before accepting a computer selector from the caller.
		const identity = await _ReviewIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Re-derive the active execution and bind its immutable Pod identity to the caller.
		const active = await _ActiveExecution(request.query, identity, response, dependencies);
		if (active === null)
			return;

		// 3. Poll through the durable authority so this route cannot skip or invent queue state.
		try
		{
			const result = await dependencies.authority.poll({ siloId: dependencies.siloId, computerId: active.computer.id, conversationId: active.computer.conversationId });
			if (result.command === null)
			{
				response.status(204).end();
				return;
			}
			response.status(200).json({ command: result.command });
		}
		catch (err)
		{
			dependencies.logger.warn({ err }, "ConversationComputer runtime command poll was denied");
			response.status(403).json({ error: "runtime_denied" });
		}
	});
	router.post("/commands/complete", async function _Complete(request: Request, response: Response)
	{
		// 1. Review the projected identity before inspecting a caller-provided terminal report.
		const identity = await _ReviewIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Parse the fixed report shape before its computer selector can trigger a history read.
		const report = _ReadReport(request.body);
		if (report === null)
		{
			response.status(400).json({ error: "invalid_runtime_command" });
			return;
		}

		// 3. Re-derive the active execution and let durable authority reject every stale report fence.
		const active = await _ActiveExecution({ computerId: report.computerId }, identity, response, dependencies);
		if (active === null)
			return;
		try
		{
			await dependencies.authority.complete({ siloId: dependencies.siloId, computerId: active.computer.id, conversationId: active.computer.conversationId, report });
			response.status(204).end();
		}
		catch (err)
		{
			dependencies.logger.warn({ err }, "ConversationComputer runtime command completion was denied");
			response.status(403).json({ error: "runtime_denied" });
		}
	});
	return router;
}

/** Reviews one projected token and hides token-review failures from a Sandbox caller. */
async function _ReviewIdentity(request: Request, response: Response, dependencies: ConversationComputerRuntimeCommandRouterDependencies): Promise<ConversationComputerRuntimeIdentity | null>
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
		dependencies.logger.error({ err }, "ConversationComputer runtime command TokenReview failed");
		response.status(503).json({ error: "runtime_unavailable" });
		return null;
	}
}

/** Derives one active execution and proves that the reviewed Pod still owns its active lease. */
async function _ActiveExecution(selector: unknown, identity: ConversationComputerRuntimeIdentity, response: Response, dependencies: ConversationComputerRuntimeCommandRouterDependencies)
{
	const computerId = _ReadComputerId(selector);
	if (computerId === null)
	{
		response.status(400).json({ error: "invalid_runtime_command" });
		return null;
	}
	try
	{
		const active = await dependencies.history.loadActiveExecutionForBootstrap({ siloId: dependencies.siloId, computerId, nowEpochMilliseconds: dependencies.clock.now().getTime() });
		if (!_MatchesLeaseRuntimePod(identity, active.lease.runtimePod))
		{
			response.status(403).json({ error: "runtime_denied" });
			return null;
		}
		return active;
	}
	catch (err)
	{
		dependencies.logger.warn({ err }, "ConversationComputer runtime command history was unavailable or inactive");
		response.status(403).json({ error: "runtime_denied" });
		return null;
	}
}

/** Reads one strict query or body computer selector without extra execution coordinates. */
function _ReadComputerId(value: unknown): string | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const values = value as Record<string, unknown>;
	if (Object.keys(values).length !== 1 || values.computerId === undefined || Array.isArray(values.computerId) || typeof values.computerId !== "string")
		return null;
	const computerId = values.computerId.trim();
	return computerId.length > 0 && computerId.length <= 128 ? computerId : null;
}

/** Reads one fixed terminal report without accepting arbitrary runtime output or diagnostic fields. */
function _ReadReport(value: unknown): ConversationComputerRuntimeTerminalReport | null
{
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const report = value as Record<string, unknown>;
	const keys = ["protocolVersion", "commandId", "computerId", "executionId", "leaseGeneration", "state"];
	if (Object.keys(report).length !== keys.length || !keys.every(key => Object.hasOwn(report, key)))
		return null;
	const leaseGeneration = report.leaseGeneration;
	if (report.protocolVersion !== CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION || typeof report.commandId !== "string" || typeof report.computerId !== "string" || typeof report.executionId !== "string" || typeof leaseGeneration !== "number" || !Number.isSafeInteger(leaseGeneration) || !Object.values(ConversationComputerRuntimeTerminalStates).includes(report.state as ConversationComputerRuntimeTerminalStates))
		return null;
	return { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: report.commandId, computerId: report.computerId, executionId: report.executionId, leaseGeneration, state: report.state as ConversationComputerRuntimeTerminalStates };
}

/** Reads one bearer token without accepting a token list or a scheme variation. */
function _ReadBearer(value: string | undefined): string | null
{
	const match = /^Bearer ([^\s,]+)$/u.exec(value ?? "");
	return match?.[1] ?? null;
}

/** Compares every Kubernetes identity field so a replacement Pod cannot use a former lease. */
function _MatchesLeaseRuntimePod(identity: ConversationComputerRuntimeIdentity, runtimePod: { readonly namespace: string; readonly serviceAccountName: string; readonly podUid: string } | null): boolean
{
	return runtimePod !== null && identity.namespace === runtimePod.namespace && identity.serviceAccountName === runtimePod.serviceAccountName && identity.podUid === runtimePod.podUid;
}
