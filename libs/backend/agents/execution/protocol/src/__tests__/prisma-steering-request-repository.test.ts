import { AgentRunState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSteeringRequestRepository } from "../prisma-steering-request-repository.js";

/** Build the smallest transaction double used by the owner-bound steering queue. */
function _prisma(priorResume: boolean, priorSteering: { readonly id: string; readonly attempt: number; readonly digest: string } | null = null): { client: PrismaClient; create: ReturnType<typeof vi.fn> }
{
	const create = vi.fn();
	const transaction = {
		$queryRaw: vi.fn().mockResolvedValue([]),
		agentRun: { findFirst: vi.fn().mockResolvedValue({ attempt: 3, state: AgentRunState.Running }) },
		runtimeDispatchedCommand: { findFirst: vi.fn().mockResolvedValue(priorResume ? { id: "resume-1" } : null) },
		runtimeSteeringRequest: { findFirst: vi.fn().mockResolvedValue(priorSteering), create },
	};
	return { client: { $transaction: vi.fn().mockImplementation(async function _transaction(callback) { return callback(transaction); }) } as unknown as PrismaClient, create };
}

describe("PrismaSteeringRequestRepository", function _suite()
{
	it("refuses a later request once the attempt has minted its sole resume", async function _refusesLaterRequest()
	{
		const context = _prisma(true);
		const repository = new PrismaSteeringRequestRepository(context.client);
		await expect(repository.submitAtomically({ runId: "run-1", siloId: "silo-1", subjectId: "user-1", content: { text: "Focus." }, idempotencyDigest: "sha256:key", digest: "sha256:key:sha256:text", submittedAt: new Date("2026-07-26T12:00:00.000Z") })).resolves.toEqual({ outcome: "run_not_steerable" });
		expect(context.create).not.toHaveBeenCalled();
	});

	it("returns the existing row for an exact retry without queueing twice", async function _ReturnsIdempotent()
	{
		const context = _prisma(false, { id: "steer-1", attempt: 3, digest: "sha256:key:sha256:text" });
		const repository = new PrismaSteeringRequestRepository(context.client);

		await expect(repository.submitAtomically({ runId: "run-1", siloId: "silo-1", subjectId: "user-1", content: { text: "Focus." }, idempotencyDigest: "sha256:key", digest: "sha256:key:sha256:text", submittedAt: new Date("2026-07-26T12:00:00.000Z") })).resolves.toEqual({ outcome: "idempotent", steeringRequestId: "steer-1", attempt: 3 });
		expect(context.create).not.toHaveBeenCalled();
	});
});
