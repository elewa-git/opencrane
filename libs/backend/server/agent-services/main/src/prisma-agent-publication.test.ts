import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuditDecisionRecord } from "@opencrane/backend/server/audit";
import { PrismaAgentServicePublicationRepository } from "./prisma-agent-publication.js";

/** Creates one locked Prisma service row. */
function _serviceRow()
{
	return {
		id: "service-1",
		siloId: "silo-1",
		kind: "Personal",
		name: "Personal agent",
		ownerScope: "User",
		ownerSubjectId: "user-1",
		state: "Draft",
		activeRevisionId: null,
		workloadProfile: "personal-default",
		createdAt: new Date("2026-07-18T00:00:00.000Z"),
		updatedAt: new Date("2026-07-18T00:00:00.000Z"),
	};
}

/** Creates one locked Prisma revision row. */
function _revisionRow()
{
	return {
		id: "revision-1",
		agentServiceId: "service-1",
		revision: 1,
		state: "Draft",
		digest: `sha256:${"1".repeat(64)}`,
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelPolicyId: "model-v1",
		budget: { maxTurns: 8, maxTokens: 8000, maxDurationMs: 60000 },
		authoredBy: "user-1",
		createdAt: new Date("2026-07-18T00:00:00.000Z"),
		publishedAt: null,
		skillAssignments: [],
		integrationAssignments: [],
	};
}

/** Creates exact audit evidence accepted by the append-only target ledger. */
function _auditDecision(): AuditDecisionRecord
{
	return {
		decisionDigest: `sha256:${"2".repeat(64)}`,
		siloId: "silo-1",
		actorKind: "user",
		actorId: "user-1",
		resourceKind: "agent-service",
		resourceId: "service-1",
		action: "publish",
		catalogId: "catalog-1",
		catalogRevision: 1,
		catalogDigest: `sha256:${"3".repeat(64)}`,
		argumentsDigest: `sha256:${"4".repeat(64)}`,
		policyRevisionHash: `sha256:${"5".repeat(64)}`,
		effectiveAuthorizationDigest: `sha256:${"6".repeat(64)}`,
		outcome: "allow",
		reasonCode: "authorized",
	};
}

describe("Prisma AgentService publication adapter", function _suite()
{
	it("commits publication, active pointer, and audit through one transaction", async function _atomicPublication()
	{
		const serviceRow = _serviceRow();
		const revisionRow = _revisionRow();
		const auditCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentService: {
				findUnique: vi.fn().mockResolvedValue(serviceRow),
				update: vi.fn().mockResolvedValue({ ...serviceRow, state: "Active", activeRevisionId: "revision-1", updatedAt: new Date("2026-07-18T01:00:00.000Z") }),
			},
			agentRevision: {
				findUnique: vi.fn().mockResolvedValue(revisionRow),
				update: vi.fn().mockResolvedValue({ ...revisionRow, state: "Published", publishedAt: new Date("2026-07-18T01:00:00.000Z") }),
			},
			auditDecision: { create: auditCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationRepository(prisma, { build: vi.fn().mockReturnValue(_auditDecision()) });

		const result = await repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result.status).toBe("published");
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		expect(auditCreate).toHaveBeenCalledOnce();
	});

	it("returns a conflict without mutation when locked authority no longer matches", async function _conflict()
	{
		const serviceRow = { ..._serviceRow(), state: "Retired" };
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentService: { findUnique: vi.fn().mockResolvedValue(serviceRow), update: vi.fn() },
			agentRevision: { findUnique: vi.fn().mockResolvedValue(_revisionRow()), update: vi.fn() },
			auditDecision: { create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationRepository(prisma, { build: vi.fn().mockReturnValue(_auditDecision()) });

		await expect(repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ status: "conflict", currentActiveRevisionId: null });
		expect(transaction.agentRevision.update).not.toHaveBeenCalled();
		expect(transaction.auditDecision.create).not.toHaveBeenCalled();
	});
});
