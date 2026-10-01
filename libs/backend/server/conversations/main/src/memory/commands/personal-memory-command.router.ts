import { Router, type Request, type Response } from "express";
import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";

import { PersonalMemoryCommandAdmissionOutcomes, PersonalMemoryCommandConflict, type PersonalMemoryCommandAdmissionResult, type PersonalMemoryCommandReceipt } from "./personal-memory-command-authority.types";
import { _ConversationFailureDiagnostic } from "../../messages/conversation-failure-diagnostic";
import type { PersonalMemoryCommandRouterDependencies } from "./personal-memory-command.router.types";
import { _PersonalMemoryCommandIdSchema, _PersonalMemoryCommandSchema } from "./personal-memory-command.validator";

/** Creates the authenticated personal-memory command admission and receipt router. */
export function _CreatePersonalMemoryCommandRouter(dependencies: PersonalMemoryCommandRouterDependencies): Router
{
	const router = Router();
	router.post("/commands", function _Post(request, response) { void _HandlePost(request, response, dependencies); });
	router.get("/commands/:commandId", function _Get(request, response) { void _HandleGet(request, response, dependencies); });
	return router;
}

/** Authenticates, validates, and admits one bounded personal-memory command. */
async function _HandlePost(request: Request, response: Response, dependencies: PersonalMemoryCommandRouterDependencies): Promise<void>
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null)
	{
		response.status(401).json({ error: "unauthorized" });
		return;
	}
	const parsed = _PersonalMemoryCommandSchema.safeParse(request.body);
	if (!parsed.success)
	{
		response.status(400).json({ error: "invalid_request" });
		return;
	}
	await ___DoWithTrace("personal_memory.command.admit", { siloId: caller.siloId, principalId: caller.principalId }, async function _Admit()
	{
		try
		{
			const result = await dependencies.authority.admit(caller, parsed.data);
			if (result === null)
			{
				response.status(404).json({ error: "memory_command_unavailable" });
				return;
			}
			response.status(result.outcome === PersonalMemoryCommandAdmissionOutcomes.Accepted ? 202 : 200).json(_SafeAdmission(result));
		}
		catch (error)
		{
			if (error instanceof PersonalMemoryCommandConflict)
			{
				response.status(409).json({ error: "memory_command_conflict" });
				return;
			}
			___MarkActiveSpanFailed();
			const diagnostic = _Diagnostic(error);
			dependencies.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: caller.siloId, principalId: caller.principalId }, "Personal memory command admission unavailable");
			response.status(503).json({ error: "memory_command_unavailable" });
		}
	});
}

/** Reads one caller-owned receipt without dispatching or advancing its operation. */
async function _HandleGet(request: Request, response: Response, dependencies: PersonalMemoryCommandRouterDependencies): Promise<void>
{
	const caller = dependencies.resolveCaller(request);
	if (caller === null)
	{
		response.status(401).json({ error: "unauthorized" });
		return;
	}
	const commandId = request.params["commandId"];
	if (Object.keys(request.query).length !== 0 || typeof commandId !== "string" || !_PersonalMemoryCommandIdSchema.safeParse(commandId).success)
	{
		response.status(400).json({ error: "invalid_request" });
		return;
	}
	await ___DoWithTrace("personal_memory.command.read", { siloId: caller.siloId, principalId: caller.principalId }, async function _Read()
	{
		try
		{
			const receipt = await dependencies.authority.read(caller, commandId);
			if (receipt === null)
			{
				response.status(404).json({ error: "memory_command_unavailable" });
				return;
			}
			response.status(200).json(_SafeReceipt(receipt));
		}
		catch (error)
		{
			___MarkActiveSpanFailed();
			const diagnostic = _Diagnostic(error);
			dependencies.logger.warn({ err: diagnostic, errorType: diagnostic.type, siloId: caller.siloId, principalId: caller.principalId }, "Personal memory command read unavailable");
			response.status(503).json({ error: "memory_command_unavailable" });
		}
	});
}

/** Projects the authority result to its documented public fields. */
function _SafeAdmission(result: PersonalMemoryCommandAdmissionResult)
{
	return { outcome: result.outcome, receipt: _SafeReceipt(result.receipt) };
}

/** Projects a receipt without trusting extra authority-owned fields. */
function _SafeReceipt(receipt: PersonalMemoryCommandReceipt)
{
	return { commandId: receipt.commandId, operationId: receipt.operationId, kind: receipt.kind, state: receipt.state, revision: receipt.revision, resultFactId: receipt.resultFactId };
}

/** Replaces the shared conversation diagnostic text with a fixed memory boundary message. */
function _Diagnostic(error: unknown)
{
	return { ..._ConversationFailureDiagnostic(error), message: "Personal memory command operation failed" };
}
