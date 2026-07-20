import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaRuntimeAuthorityRepository } from "../prisma-runtime-authority.js";
import type { CapabilityActionIntent, RuntimeBootstrapClaim } from "../runtime-proof.types.js";

/** Creates one exact runtime bootstrap claim. */
function _bootstrap(): RuntimeBootstrapClaim
{
	return {
		bootstrapId: "bootstrap-1",
		siloId: "silo-1",
		audience: "opencrane",
		subjectId: "user-1",
		serviceAccountName: "runtime",
		namespace: "silo-1-runtime",
		workloadKind: "job",
		workloadUid: "job-1",
		podUid: "pod-1",
		runId: "run-1",
		agentServiceId: "service-1",
		attempt: 1,
		agentRevisionId: "revision-1",
		proofPublicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
		proofKeyThumbprint: "k".repeat(43),
		expiresAtEpochMs: Date.parse("2026-07-18T02:00:00.000Z"),
	};
}

/** Creates one verified proof-bound action intent. */
function _intent(): CapabilityActionIntent
{
	return {
		jti: "jti-1",
		requestFingerprint: `sha256:${"1".repeat(64)}`,
		replayMode: "one_shot",
		audience: "artifact-service",
		siloId: "silo-1",
		subjectId: "user-1",
		serviceAccountName: "runtime",
		namespace: "silo-1-runtime",
		workloadKind: "job",
		workloadUid: "job-1",
		podUid: "pod-1",
		runId: "run-1",
		attempt: 1,
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		proofKeyThumbprint: "k".repeat(43),
		catalogId: "catalog-1",
		catalogRevision: 1,
		catalogDigest: `sha256:${"2".repeat(64)}`,
		capabilityId: "artifact.write",
		effectivePolicyDigest: `sha256:${"3".repeat(64)}`,
		resourceKind: "artifact",
		resourceId: "artifact-1",
		action: "write",
		argumentsDigest: `sha256:${"4".repeat(64)}`,
	};
}

describe("Prisma runtime authority adapter", function _suite()
{
	it("consumes bootstrap and stores only its public proof key in one transaction", async function _consume()
	{
		const bootstrapUpdate = vi.fn().mockResolvedValue({ id: "bootstrap-1" });
		const proofCreate = vi.fn().mockResolvedValue({ id: "proof-1" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue({ id: "bootstrap-1", consumedAt: null }), update: bootstrapUpdate },
			runProofKey: { create: proofCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRuntimeAuthorityRepository(prisma);

		const result = await repository.consumeAndBindProofKeyAtomically(_bootstrap());

		expect(result.status).toBe("consumed");
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
		expect(bootstrapUpdate).toHaveBeenCalledOnce();
		expect(proofCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, keyThumbprint: "k".repeat(43) }) });
	});

	it("reserves receipt and appends audit before external action execution", async function _reserve()
	{
		const receiptCreate = vi.fn().mockResolvedValue({ id: "receipt-1" });
		const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			actionExecutionReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: receiptCreate },
			runProofKey: { findUnique: vi.fn().mockResolvedValue({ id: "proof-1" }) },
			auditDecision: { create: auditCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRuntimeAuthorityRepository(prisma);

		await expect(repository.reserve(_intent())).resolves.toEqual({ status: "reserved", reservationId: "receipt-1" });
		expect(receiptCreate).toHaveBeenCalledOnce();
		expect(auditCreate).toHaveBeenCalledOnce();
	});
});
