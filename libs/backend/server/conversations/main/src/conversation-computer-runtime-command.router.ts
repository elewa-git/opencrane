import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeCommandKinds, ConversationComputerRuntimeTerminalStates, type ConversationComputerRuntimeCommandEnvelope, type ConversationComputerRuntimeTerminalReport } from "@opencrane/contracts";
import { Router, type Request, type Response } from "express";

import { _AdmitConversationComputerRuntime, _ReviewConversationComputerRuntimeIdentity } from "./conversation-computer-runtime-admission";
import type { ConversationComputerRuntimeCommandRouterDependencies, ConversationComputerRuntimeWorkPackage } from "./conversation-computer-runtime-command.router.types";

/** Recognizes the UUID runtime coordinates that the durable command authority accepts. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Builds the Sandbox-only command route for one active ConversationComputer execution. */
export function __CreateConversationComputerRuntimeCommandRouter(dependencies: ConversationComputerRuntimeCommandRouterDependencies): Router
{
	const router = Router();
	router.get("/commands/next", async function _Next(request: Request, response: Response)
	{
		// 1. Review the projected identity before accepting a computer selector from the caller.
		const identity = await _ReviewConversationComputerRuntimeIdentity(request, response, dependencies);
		if (identity === null)
			return;

		// 2. Parse the sole selector before it can trigger a server history read.
		const computerId = _ReadComputerId(request.query);
		if (computerId === null)
		{
			response.status(400).json({ error: "invalid_runtime_command" });
			return;
		}

		// 3. Re-derive the active execution and bind its immutable Pod identity to the caller.
		const admission = await _AdmitConversationComputerRuntime(computerId, identity, response, dependencies);
		if (admission === null)
			return;
		const active = admission.active;

		// 4. Poll through the durable authority so this route cannot skip or invent queue state.
		try
		{
			const result = await dependencies.authority.poll({ siloId: dependencies.siloId, computerId: active.computer.id, conversationId: active.computer.conversationId });
			if (result.command === null)
			{
				response.status(204).end();
				return;
			}
			// 5. Redeem only the selected oldest input, after the active lease has fenced the caller.
			const work = await _WorkPackage(result.command, dependencies, active.computer.conversationId);
			response.status(200).json({ work });
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
		const identity = await _ReviewConversationComputerRuntimeIdentity(request, response, dependencies);
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
		const admission = await _AdmitConversationComputerRuntime(report.computerId, identity, response, dependencies);
		if (admission === null)
			return;
		const active = admission.active;
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

/** Builds one runtime work package without returning the command's private storage reference. */
async function _WorkPackage(command: ConversationComputerRuntimeCommandEnvelope, dependencies: ConversationComputerRuntimeCommandRouterDependencies, conversationId: string): Promise<ConversationComputerRuntimeWorkPackage>
{
	if (command.kind !== ConversationComputerRuntimeCommandKinds.StartTurn)
		throw new Error("ConversationComputer runtime command kind is unsupported");
	const inputText = await dependencies.payloads.readText({
		siloId: dependencies.siloId,
		conversationId,
		idempotencyKey: command.payload.inputEntryId,
		payloadRef: command.payload.inputPayloadRef as `payload://${string}`,
		ciphertextDigest: command.payload.inputPayloadDigest,
	});
	const { payload: _payload, ...commandFence } = command;
	return { command: commandFence, inputEntryId: command.payload.inputEntryId, inputText };
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
	if (report.protocolVersion !== CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION || typeof report.commandId !== "string" || typeof report.computerId !== "string" || typeof report.executionId !== "string" || typeof leaseGeneration !== "number" || !_UUID_PATTERN.test(report.commandId) || !_UUID_PATTERN.test(report.executionId) || report.computerId.trim().length === 0 || report.computerId.length > 128 || !Number.isSafeInteger(leaseGeneration) || leaseGeneration < 1 || !Object.values(ConversationComputerRuntimeTerminalStates).includes(report.state as ConversationComputerRuntimeTerminalStates))
		return null;
	return { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: report.commandId, computerId: report.computerId, executionId: report.executionId, leaseGeneration, state: report.state as ConversationComputerRuntimeTerminalStates };
}
