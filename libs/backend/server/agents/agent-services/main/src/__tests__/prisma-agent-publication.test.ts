import { McpApprovalStatus, McpServerRevisionState, McpServerStatus, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAgentServicePublicationUnitOfWork } from "../db/prisma-agent-publication";

/** Allows current root Organization administration in publication persistence tests. */
function _AuthorizationFactory()
{
	return function _CreateAuthorization() { return { admitPrincipal: vi.fn().mockResolvedValue({ outcome: "allow" }) } as never; };
}

/** Authenticated management caller bound to each publication unit of work. */
const _CALLER = { principalId: "admin-1", siloId: "silo-1" } as const;

/** Creates one locked Prisma service row. */
function _serviceRow()
{
	return {
		id: "service-1",
		siloId: "silo-1",
		kind: "Personal",
		name: "Personal agent",
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
		parentRevisionId: null,
		sourceRevisionId: null,
		changeMessage: "initial",
		state: "Draft",
		digest: `sha256:${"1".repeat(64)}`,
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelDefinitionId: "model-definition-1",
		budget: { maxTurns: 8, maxTokens: 8000, maxDurationMs: 60000 },
		authoredBy: "user-1",
		createdAt: new Date("2026-07-18T00:00:00.000Z"),
		publishedAt: null,
		skillAssignments: [],
		mcpToolAssignments: [],
		boundaryAttachments: [],
	};
}

/** Creates one exact publication-eligible MCP assignment row. */
function _McpToolAssignment()
{
	return { siloId: "silo-1", toolRevisionId: "mcp-tool-revision-1", toolRevision: { serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } } };
}

describe("Prisma AgentService publication adapter", function _suite()
{
	it("commits publication and active pointer through one transaction", async function _atomicPublication()
	{
		const serviceRow = _serviceRow();
		const revisionRow = _revisionRow();
		const transaction = {
			agentService: {
				findUnique: vi.fn().mockResolvedValue(serviceRow),
				findUniqueOrThrow: vi.fn().mockResolvedValue({ ...serviceRow, state: "Active", activeRevisionId: "revision-1", updatedAt: new Date("2026-07-18T01:00:00.000Z") }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
			agentRevision: {
				findUnique: vi.fn().mockResolvedValue(revisionRow),
				findUniqueOrThrow: vi.fn().mockResolvedValue({ ...revisionRow, state: "Published", publishedAt: new Date("2026-07-18T01:00:00.000Z") }),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationUnitOfWork(prisma, _CALLER, _AuthorizationFactory());

		const result = await repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result.status).toBe("published");
		expect(transaction.agentService.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "Draft", activeRevisionId: null }) }));
		expect(transaction.agentRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "Draft" }) }));
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
	});

	it("returns a conflict without mutation when locked authority no longer matches", async function _conflict()
	{
		const serviceRow = { ..._serviceRow(), state: "Retired" };
		const transaction = {
			agentService: { findUnique: vi.fn().mockResolvedValue(serviceRow), updateMany: vi.fn() },
			agentRevision: { findUnique: vi.fn().mockResolvedValue(_revisionRow()), updateMany: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationUnitOfWork(prisma, _CALLER, _AuthorizationFactory());

		await expect(repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ status: "conflict", currentActiveRevisionId: null });
		expect(transaction.agentRevision.updateMany).not.toHaveBeenCalled();
	});

	it("denies publication before mutation when Organization administration is absent", async function _DeniesUnauthorizedPublication()
	{
		const transaction = {
			agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()), updateMany: vi.fn() },
			agentRevision: { findUnique: vi.fn().mockResolvedValue(_revisionRow()), updateMany: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationUnitOfWork(prisma, _CALLER, function _Authorization() { return { admitPrincipal: vi.fn().mockResolvedValue({ outcome: "deny" }) } as never; });

		await expect(repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ status: "unauthorized" });
		expect(transaction.agentService.updateMany).not.toHaveBeenCalled();
		expect(transaction.agentRevision.updateMany).not.toHaveBeenCalled();
	});

	it("refuses publication when an exact MCP tool is not Ready and published", async function _RefusesUnavailableMcpTool()
	{
		const serviceRow = _serviceRow();
		const assignment = _McpToolAssignment();
		const revisionRow = { ..._revisionRow(), mcpToolAssignments: [{ ...assignment, toolRevision: { serverRevision: { ...assignment.toolRevision.serverRevision, state: McpServerRevisionState.Discovering } } }] };
		const transaction = {
			agentService: { findUnique: vi.fn().mockResolvedValue(serviceRow), updateMany: vi.fn() },
			agentRevision: { findUnique: vi.fn().mockResolvedValue(revisionRow), updateMany: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentServicePublicationUnitOfWork(prisma, _CALLER, _AuthorizationFactory());

		await expect(repository.publishRevisionAtomically({ agentServiceId: "service-1", agentRevisionId: "revision-1", expectedServiceState: "draft", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ status: "invalid_revision" });
		expect(transaction.agentRevision.updateMany).not.toHaveBeenCalled();
	});
});
