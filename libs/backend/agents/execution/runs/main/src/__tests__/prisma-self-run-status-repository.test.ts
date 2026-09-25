import { ToolInvocationState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunToolProgressPhases } from "@opencrane/contracts";

import { PrismaSelfRunStatusRepository } from "../prisma-self-run-status-repository";

/** Creates the selected persisted fields for one owner-visible run. */
function _runRow()
{
	return { id: "run-1", attempt: 2, state: "WaitingForInput", conversationId: "conversation-1", agentRevisionId: "revision-1", acceptedAt: new Date("2026-07-26T12:00:00.000Z"), finishedAt: null };
}

describe("Prisma self run status repository", function _suite()
{
	it("binds the recent list to the exact owner and silo, with a bounded newest-first window", async function _listsOwnedRuns()
	{
		const findMany = vi.fn().mockResolvedValue([_runRow()]);
		const findFirst = vi.fn().mockResolvedValue(_runRow());
		const readProgress = vi.fn().mockResolvedValue({ state: ToolInvocationState.Succeeded });
		const prisma = { agentRun: { findMany, findFirst }, toolInvocation: { findFirst: readProgress } } as unknown as PrismaClient;
		const listPrincipalEntitled = vi.fn().mockImplementation(async function _Allow(command) { return command.resources; });
		const repository = new PrismaSelfRunStatusRepository(prisma as never, { listPrincipalEntitled } as never);

		await expect(repository.listOwned({ siloId: "silo-1", principalId: "principal-1" })).resolves.toEqual([{ runId: "run-1", attempt: 2, state: "waiting_for_input", latestTool: { phase: RunToolProgressPhases.ResultReceived }, conversationId: "conversation-1", agentRevisionId: "revision-1", acceptedAt: "2026-07-26T12:00:00.000Z", finishedAt: null }]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", principalId: { equals: "principal-1" } }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: 200 }));
		expect(listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: "read", resources: [{ kind: "agent-run", id: "run-1" }] }));
		expect(readProgress).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1", runId: "run-1", attempt: 2, mcpTaskId: null } }));
	});

	it("does not read progress for an absent or unauthorized run", async function _DeniedDetail()
	{
		const findMany = vi.fn().mockResolvedValue([]);
		const findFirst = vi.fn().mockResolvedValue(_runRow());
		const readProgress = vi.fn().mockResolvedValue({ state: ToolInvocationState.Succeeded });
		const repository = new PrismaSelfRunStatusRepository({ agentRun: { findMany, findFirst }, toolInvocation: { findFirst: readProgress } } as never, { listPrincipalEntitled: vi.fn().mockResolvedValue([]) } as never);

		await expect(repository.readOwned({ siloId: "silo-1", principalId: "principal-1" }, "run-1")).resolves.toBeNull();
		findFirst.mockResolvedValue(null);
		await expect(repository.readOwned({ siloId: "silo-1", principalId: "principal-1" }, "foreign")).resolves.toBeNull();
		findMany.mockResolvedValue([_runRow()]);
		await expect(repository.listOwned({ siloId: "silo-1", principalId: "principal-1" })).resolves.toEqual([]);
		expect(readProgress).not.toHaveBeenCalled();
	});
});
