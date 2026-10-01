import { describe, expect, it, vi } from "vitest";

import { McpInvocationDispatchOutcomes, McpInvocationOwnerKinds } from "@opencrane/backend/server/gateways/mcp";

import { _CreateConversationMcpToolDispatch } from "../mcp-runtime-composition";

describe("conversation MCP dispatch composition", function _Suite()
{
	it.each([
		[McpInvocationDispatchOutcomes.AwaitingOciCompanion, false],
		[McpInvocationDispatchOutcomes.Completed, true],
		[McpInvocationDispatchOutcomes.Terminal, true],
	])("preserves the saved run owner and handles %s", async function _PreservesOwner(outcome, progressed)
	{
		const execute = vi.fn().mockResolvedValue(outcome);
		const dispatch = _CreateConversationMcpToolDispatch({ execute, settleExhausted: vi.fn() });
		const command = { siloId: "silo-one", runId: "run-one", attempt: 3, toolInvocationId: "public-call-one" };

		await expect(dispatch.tryExecute(command)).resolves.toBe(progressed);
		expect(execute).toHaveBeenCalledExactlyOnceWith({ ownerKind: McpInvocationOwnerKinds.Run, ...command });
	});

	it("does not turn an unavailable dispatch into a successful workflow step", async function _KeepsFailure()
	{
		const failure = new Error("dispatch authority unavailable");
		const execute = vi.fn().mockRejectedValue(failure);
		const dispatch = _CreateConversationMcpToolDispatch({ execute, settleExhausted: vi.fn() });
		await expect(dispatch.tryExecute({ siloId: "silo-one", runId: "run-one", attempt: 3, toolInvocationId: "public-call-one" })).rejects.toBe(failure);
	});

	it.each([true, false])("settles exhausted work under the saved run coordinates: %s", async function _SettlesSavedOwner(settled)
	{
		const execute = vi.fn();
		const settleExhausted = vi.fn().mockResolvedValue(settled);
		const dispatch = _CreateConversationMcpToolDispatch({ execute, settleExhausted });
		const command = { siloId: "silo-one", runId: "run-one", attempt: 3, toolInvocationId: "public-call-one" };

		await expect(dispatch.settleExhausted(command)).resolves.toBe(settled);
		expect(settleExhausted).toHaveBeenCalledExactlyOnceWith({ ownerKind: McpInvocationOwnerKinds.Run, ...command });
		expect(execute).not.toHaveBeenCalled();
	});
});
