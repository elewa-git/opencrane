import { ToolInvocationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunToolProgressPhases } from "@opencrane/contracts";

import { __ReadRunToolProgressInTransaction } from "../../persistence/tool-invocation-transaction";

const _COMMAND = { siloId: "silo-1", runId: "run-1", attempt: 2 };

describe("IAM phase-only run tool progress", function _Suite()
{
	it.each([
		[ToolInvocationState.Preparing, RunToolProgressPhases.Queued],
		[ToolInvocationState.Ready, RunToolProgressPhases.Queued],
		[ToolInvocationState.Claimed, RunToolProgressPhases.Running],
		[ToolInvocationState.Reconciling, RunToolProgressPhases.Running],
		[ToolInvocationState.Succeeded, RunToolProgressPhases.ResultReceived],
		[ToolInvocationState.AwaitingApproval, RunToolProgressPhases.NeedsAttention],
		[ToolInvocationState.Failed, RunToolProgressPhases.NeedsAttention],
		[ToolInvocationState.RecoveryRequired, RunToolProgressPhases.NeedsAttention],
	])("maps persisted %s to public %s without another field", async function _Maps(state, phase)
	{
		const findFirst = vi.fn().mockResolvedValue({ state });
		await expect(__ReadRunToolProgressInTransaction({ toolInvocation: { findFirst } } as never, _COMMAND)).resolves.toEqual({ phase });
		expect(findFirst).toHaveBeenCalledExactlyOnceWith({ where: { ..._COMMAND, mcpTaskId: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { state: true } });
	});

	it("returns null only for an absent invocation and propagates database failure", async function _AbsentAndFailed()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const transaction = { toolInvocation: { findFirst } };
		await expect(__ReadRunToolProgressInTransaction(transaction as never, _COMMAND)).resolves.toBeNull();
		findFirst.mockRejectedValue(new Error("database unavailable"));
		await expect(__ReadRunToolProgressInTransaction(transaction as never, _COMMAND)).rejects.toThrow("database unavailable");
	});

	it.each(["Unknown", "toString", null, undefined])("rejects unknown persisted state %s instead of hiding it as no progress", async function _Unknown(state)
	{
		const findFirst = vi.fn().mockResolvedValue({ state });
		await expect(__ReadRunToolProgressInTransaction({ toolInvocation: { findFirst } } as never, _COMMAND)).rejects.toThrow("Run tool progress state is invalid");
	});

	it.each([{ siloId: "" }, { runId: " " }, { attempt: 0 }, { attempt: 1.5 }, { attempt: undefined }])("refuses unbounded coordinates %j before any read", async function _Coordinates(patch)
	{
		const findFirst = vi.fn();
		await expect(__ReadRunToolProgressInTransaction({ toolInvocation: { findFirst } } as never, { ..._COMMAND, ...patch } as never)).rejects.toThrow("coordinates are invalid");
		expect(findFirst).not.toHaveBeenCalled();
	});
});
