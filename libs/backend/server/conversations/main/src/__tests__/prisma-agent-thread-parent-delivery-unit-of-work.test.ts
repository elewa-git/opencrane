import { AgentRunState, AgentThreadDeliveryKind, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";

import { PrismaAgentThreadParentDeliveryUnitOfWork } from "../db/prisma-agent-thread-parent-delivery-unit-of-work.js";

const _IDENTITY = { namespace: "runtime", serviceAccountName: "agent-runtime-service-1", podUid: "pod-1" } as const;
const _COMMAND = { childConversationId: "child-1", runId: "run-1", idempotencyKey: "delivery-1", kind: AgentThreadDeliveryKinds.Result, label: "Done", detail: "The requested work is ready.", assetId: null } as const;

function _Row(): object
{
	return { id: "delivery-1", childConversationId: "child-1", parentConversationId: "parent-1", runId: "run-1", agentServiceId: "service-1", kind: AgentThreadDeliveryKind.Result, label: "Done", detail: "The requested work is ready.", assetId: null, createdAt: new Date("2026-08-12T10:00:00.000Z") };
}

function _Authority(transaction: object): PrismaAgentThreadParentDeliveryUnitOfWork
{
	return new PrismaAgentThreadParentDeliveryUnitOfWork({ $transaction: vi.fn(async function _Transaction(work) { return work(transaction); }) } as never);
}

/** Active attempt coordinates returned by the runtime-assignment authority. */
function _Assignment(): object { return { siloId: "silo-1", agentServiceId: "service-1", attempt: 1, run: { attempt: 1 } }; }

describe("PrismaAgentThreadParentDeliveryUnitOfWork", function _Suite()
{
	it("appends one delivery only after resolving its exact immutable thread", async function _Delivers()
	{
		const create = vi.fn().mockResolvedValue(_Row());
		const transaction = { agentThreadParentDelivery: { findUnique: vi.fn().mockResolvedValue(null), create }, workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) }, conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ parentConversationId: "parent-1" }) } };
		await expect(_Authority(transaction).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "accepted", delivery: expect.objectContaining({ parentConversationId: "parent-1", kind: "result" }) });
		expect(transaction.conversationAgentThread.findFirst).toHaveBeenCalledWith({ where: { childConversationId: "child-1", siloId: "silo-1", agentServiceId: "service-1", childConversation: { lifecycle: "Open" } }, select: { parentConversationId: true } });
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ childConversationId: "child-1", parentConversationId: "parent-1", runId: "run-1", detail: "The requested work is ready." }) });
	});

	it("returns an exact retry and rejects changed content", async function _Idempotency()
	{
		const transaction = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) }, conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ parentConversationId: "parent-1" }) }, agentThreadParentDelivery: { findUnique: vi.fn().mockResolvedValue(_Row()) } };
		await expect(_Authority(transaction).deliver(_IDENTITY, _COMMAND)).resolves.toEqual(expect.objectContaining({ outcome: "idempotent" }));
		await expect(_Authority(transaction).deliver(_IDENTITY, { ..._COMMAND, detail: "Changed" })).resolves.toEqual({ outcome: "denied", reason: "idempotency_conflict" });
	});

	it("derives service and silo only from the registered live runtime assignment", async function _DerivesAuthority()
	{
		const existing = vi.fn();
		const transaction = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue(null) }, conversationAgentThread: { findFirst: vi.fn() }, agentThreadParentDelivery: { findUnique: existing } };
		await expect(_Authority(transaction).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "authority_unavailable" });
		expect(transaction.workloadAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ runId: "run-1", namespace: "runtime", serviceAccountName: "agent-runtime-service-1", podUid: "pod-1", state: "Registered", expiresAt: { gt: expect.any(Date) }, run: { state: AgentRunState.Running } }), select: expect.objectContaining({ attempt: true, run: { select: { attempt: true } } }) }));
		expect(transaction.conversationAgentThread.findFirst).not.toHaveBeenCalled();
		expect(existing).not.toHaveBeenCalled();
	});

	it("rejects a registered assignment after its run becomes terminal or advances attempt", async function _RejectsInactiveRun()
	{
		const thread = vi.fn();
		const terminal = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue(null) }, conversationAgentThread: { findFirst: thread } };
		const staleAttempt = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue({ ..._Assignment(), attempt: 1, run: { attempt: 2 } }) }, conversationAgentThread: { findFirst: thread } };

		await expect(_Authority(terminal).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "authority_unavailable" });
		await expect(_Authority(staleAttempt).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "authority_unavailable" });
		expect(thread).not.toHaveBeenCalled();
	});

	it("rejects non-asset delivery attempts that smuggle an asset coordinate", async function _RejectsShape()
	{
		await expect(_Authority({}).deliver(_IDENTITY, { ..._COMMAND, assetId: "asset-1" })).resolves.toEqual({ outcome: "denied", reason: "invalid_display_content" });
	});

	it("logs only bounded authority coordinates when persistence fails", async function _LogsFailure()
	{
		const error = vi.fn();
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Error("database unavailable")) };
		await expect(new PrismaAgentThreadParentDeliveryUnitOfWork(prisma as never, { error } as never).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), conversationId: "child-1", runId: "run-1", namespace: "runtime", podUid: "pod-1" }), expect.any(String));
		expect(JSON.stringify(error.mock.calls)).not.toContain(_COMMAND.detail);
	});

	it("binds every delegate to the serializable transaction and lets Prisma roll back a failed insert", async function _BindsTransaction()
	{
		const insertFailure = new Error("delivery insert failed");
		const transaction = { workloadAssignment: { findFirst: vi.fn().mockResolvedValue(_Assignment()) }, conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ parentConversationId: "parent-1" }) }, agentThreadParentDelivery: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(insertFailure) } };
		const rootAssignment = vi.fn();
		const $transaction = vi.fn(async function _Transaction(work, options)
		{
			expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			return work(transaction);
		});
		const error = vi.fn();
		const prisma = { $transaction, workloadAssignment: { findFirst: rootAssignment } };

		await expect(new PrismaAgentThreadParentDeliveryUnitOfWork(prisma as never, { error } as never).deliver(_IDENTITY, _COMMAND)).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect($transaction).toHaveBeenCalledTimes(1);
		expect(rootAssignment).not.toHaveBeenCalled();
		expect(transaction.agentThreadParentDelivery.create).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: insertFailure }), expect.any(String));
	});
});
