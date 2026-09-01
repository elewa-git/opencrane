import { describe, expect, it, vi } from "vitest";

import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaRunCancellationRepository } from "../prisma-run-cancellation-repository";
import { SelfRunCancellationOutcomes } from "../self-run-cancellation.types";

/** Builds owner lookup and central authority doubles for one cancellation transaction. */
function _Dependencies(owned: boolean, allowed: boolean)
{
	const findFirst = vi.fn().mockResolvedValue(owned ? { id: "run-1" } : null);
	const admitPrincipal = vi.fn().mockResolvedValue({ outcome: allowed ? AuthorizationDecisionOutcomes.Allow : AuthorizationDecisionOutcomes.Deny });
	const repository = new PrismaRunCancellationRepository({ agentRun: { findFirst } } as never, { admitPrincipal } as never);
	return { admitPrincipal, findFirst, repository };
}

describe("Prisma owner run cancellation", function _Suite()
{
	it("hides a foreign run before consulting product authorization", async function _HidesForeignRun()
	{
		const dependencies = _Dependencies(false, true);
		await expect(dependencies.repository.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", principalId: "principal-1" }, new Date(1))).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.NotFound });
		expect(dependencies.findFirst).toHaveBeenCalledWith({ where: { id: "run-1", siloId: "silo-1", principalId: { equals: "principal-1" } }, select: { id: true } });
		expect(dependencies.admitPrincipal).not.toHaveBeenCalled();
	});

	it("hides an owned run when its exact cancel grant is absent", async function _DeniesWithoutGrant()
	{
		const dependencies = _Dependencies(true, false);
		const cancel = vi.spyOn(dependencies.repository, "requestCancellation");
		await expect(dependencies.repository.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", principalId: "principal-1" }, new Date(1))).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.NotFound });
		expect(dependencies.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", resource: { kind: "agent-run", id: "run-1" }, action: "cancel" }));
		expect(cancel).not.toHaveBeenCalled();
	});

	it("applies attempt-fenced cancellation after current exact authorization", async function _CancelsAuthorizedRun()
	{
		const dependencies = _Dependencies(true, true);
		vi.spyOn(dependencies.repository, "requestCancellation").mockResolvedValue({ status: "cancelling", runId: "run-1", attempt: 3 });
		await expect(dependencies.repository.requestOwned({ runId: "run-1", expectedAttempt: 3, siloId: "silo-1", principalId: "principal-1" }, new Date(1))).resolves.toEqual({ outcome: SelfRunCancellationOutcomes.Cancelling, runId: "run-1", attempt: 3 });
		expect(dependencies.repository.requestCancellation).toHaveBeenCalledWith({ runId: "run-1", expectedAttempt: 3 }, new Date(1));
	});
});
