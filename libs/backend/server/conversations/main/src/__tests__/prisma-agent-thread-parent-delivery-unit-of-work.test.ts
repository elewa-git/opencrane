import { AgentThreadDeliveryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";

import { PrismaAgentThreadParentDeliveryUnitOfWork } from "../prisma-agent-thread-parent-delivery-unit-of-work.js";

const _COMMAND = { siloId: "silo-1", childConversationId: "child-1", runId: "run-1", agentServiceId: "service-1", idempotencyKey: "delivery-1", kind: AgentThreadDeliveryKinds.Result, label: "Done", detail: "The requested work is ready.", assetId: null } as const;

function _Row(): object
{
	return { id: "delivery-1", childConversationId: "child-1", parentConversationId: "parent-1", runId: "run-1", agentServiceId: "service-1", kind: AgentThreadDeliveryKind.Result, label: "Done", detail: "The requested work is ready.", assetId: null, createdAt: new Date("2026-08-12T10:00:00.000Z") };
}

function _Authority(transaction: object): PrismaAgentThreadParentDeliveryUnitOfWork
{
	return new PrismaAgentThreadParentDeliveryUnitOfWork({ $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) } as never);
}

describe("PrismaAgentThreadParentDeliveryUnitOfWork", function _Suite()
{
	it("appends one delivery only after resolving its exact immutable thread", async function _Delivers()
	{
		const create = vi.fn().mockResolvedValue(_Row());
		const transaction = { agentThreadParentDelivery: { findUnique: vi.fn().mockResolvedValue(null), create }, conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ parentConversationId: "parent-1" }) } };
		await expect(_Authority(transaction).deliver(_COMMAND)).resolves.toEqual({ outcome: "accepted", delivery: expect.objectContaining({ parentConversationId: "parent-1", kind: "result" }) });
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ childConversationId: "child-1", parentConversationId: "parent-1", runId: "run-1", detail: "The requested work is ready." }) });
	});

	it("returns an exact retry and rejects changed content", async function _Idempotency()
	{
		const transaction = { agentThreadParentDelivery: { findUnique: vi.fn().mockResolvedValue(_Row()) } };
		await expect(_Authority(transaction).deliver(_COMMAND)).resolves.toEqual(expect.objectContaining({ outcome: "idempotent" }));
		await expect(_Authority(transaction).deliver({ ..._COMMAND, detail: "Changed" })).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("rejects non-asset delivery attempts that smuggle an asset coordinate", async function _RejectsShape()
	{
		await expect(_Authority({}).deliver({ ..._COMMAND, assetId: "asset-1" })).resolves.toEqual({ outcome: "denied", reason: "invalid_display_content" });
	});

	it("logs only bounded authority coordinates when persistence fails", async function _LogsFailure()
	{
		const error = vi.fn();
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Error("database unavailable")) };
		await expect(new PrismaAgentThreadParentDeliveryUnitOfWork(prisma as never, { error } as never).deliver(_COMMAND)).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), siloId: "silo-1", conversationId: "child-1", runId: "run-1", agentServiceId: "service-1" }), expect.any(String));
		expect(JSON.stringify(error.mock.calls)).not.toContain(_COMMAND.detail);
	});
});
