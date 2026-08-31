import express from "express";
import request from "supertest";
import { AgentThreadDeliveryKind, ConversationTimelineEntryKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AgentThreadDeliveryKinds } from "@opencrane/backend/conversations/agent-threads";
import { ConversationProjectionReadStatuses } from "@opencrane/backend/conversations/projection";

import { __CreateAgentThreadParentDeliveryRouter } from "../agent-thread-parent-delivery.router";
import { PrismaAgentThreadParentDeliveryUnitOfWork } from "../db/prisma-agent-thread-parent-delivery-unit-of-work";
import { PrismaConversationReplayRepository } from "../db/prisma-conversation-replay-repository";

const _IDENTITY = { namespace: "runtime", serviceAccountName: "agent-runtime-service-1", podUid: "pod-1" } as const;
const _BODY = { runId: "run-1", childConversationId: "child-1", idempotencyKey: "delivery-1", kind: AgentThreadDeliveryKinds.Result, label: "Done", detail: "The requested work is ready.", assetId: null } as const;

/** Build the private runtime router with exact replaceable authority collaborators. */
function _App(overrides: Record<string, unknown> = {})
{
	const dependencies = { tokenReviewer: { __Review: vi.fn().mockResolvedValue(_IDENTITY) }, authority: { deliver: vi.fn().mockResolvedValue({ outcome: "denied", reason: "authority_unavailable" }) }, logger: { error: vi.fn() }, ...overrides };
	const app = express();
	app.use(express.json());
	app.use(__CreateAgentThreadParentDeliveryRouter(dependencies as never));
	return { app, dependencies };
}

describe("Agent thread parent delivery router", function _Suite()
{
	it("derives workload identity from TokenReview and appends a display-safe delivery", async function _Delivers()
	{
		const authority = { deliver: vi.fn().mockResolvedValue({ outcome: "accepted", delivery: { id: "delivery-1" } }) };
		const { app, dependencies } = _App({ authority });
		const response = await request(app).post("/agent-threads/parent-deliveries").set("authorization", "Bearer projected-token").send(_BODY);

		expect(response.status).toBe(201);
		expect(dependencies.tokenReviewer.__Review).toHaveBeenCalledWith("projected-token");
		expect(authority.deliver).toHaveBeenCalledWith(_IDENTITY, _BODY);
	});

	it("rejects absent runtime proof before delivery authority", async function _Unauthorized()
	{
		const authority = { deliver: vi.fn() };
		const { app } = _App({ authority });
		const response = await request(app).post("/agent-threads/parent-deliveries").send(_BODY);

		expect(response.status).toBe(401);
		expect(authority.deliver).not.toHaveBeenCalled();
	});

	it("rejects browser-supplied silo and service authority coordinates", async function _StrictBody()
	{
		const authority = { deliver: vi.fn() };
		const { app } = _App({ authority });
		const response = await request(app).post("/agent-threads/parent-deliveries").set("authorization", "Bearer projected-token").send({ ..._BODY, siloId: "spoofed", agentServiceId: "spoofed" });

		expect(response.status).toBe(400);
		expect(authority.deliver).not.toHaveBeenCalled();
	});

	it("returns exact idempotent replay and stable denial statuses", async function _MapsOutcomes()
	{
		const authority = { deliver: vi.fn()
			.mockResolvedValueOnce({ outcome: "idempotent", delivery: { id: "delivery-1" } })
			.mockResolvedValueOnce({ outcome: "denied", reason: "idempotency_conflict" })
			.mockResolvedValueOnce({ outcome: "denied", reason: "persistence_unavailable" }) };
		const { app } = _App({ authority });
		const post = function _Post() { return request(app).post("/agent-threads/parent-deliveries").set("authorization", "Bearer projected-token").send(_BODY); };

		expect((await post()).status).toBe(200);
		expect((await post()).status).toBe(409);
		expect((await post()).status).toBe(503);
	});

	it("projects one runtime-produced delivery on the immediate parent's canonical stream", async function _ProjectsParentDelivery()
	{
		let saved: Record<string, unknown> = {};
		const deliveryTransaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ attempt: 1, state: "Running" }) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue({ runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", namespace: "runtime", serviceAccountName: "agent-runtime-service-1", state: "Registered", revokedAt: null, workloadKind: "Deployment", expiresAt: new Date(Date.now() + 60_000), bindingGeneration: 2 }) },
			warmRuntimeReservation: { findUnique: vi.fn().mockResolvedValue({ generation: 2, state: "Claimed", namespace: "runtime", serviceAccountName: "agent-runtime-service-1", podUid: "pod-1", idleDeadline: new Date(Date.now() + 60_000) }) },
			conversationAgentThread: { findFirst: vi.fn().mockResolvedValue({ parentConversationId: "parent-1" }) },
			agentThreadParentDelivery: {
				findUnique: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockImplementation(async function _Create({ data }: { readonly data: Record<string, unknown> }) { saved = { ...data, createdAt: new Date("2026-08-12T10:00:00.000Z") }; return saved; }),
			},
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(work) { return work(deliveryTransaction); }) };
		const { app } = _App({ authority: new PrismaAgentThreadParentDeliveryUnitOfWork(prisma as never) });
		expect((await request(app).post("/agent-threads/parent-deliveries").set("authorization", "Bearer projected-token").send(_BODY)).status).toBe(201);
		if (typeof saved["id"] !== "string") throw new Error("delivery was not saved");

		const timeline = { conversationId: "parent-1", position: 9n, kind: ConversationTimelineEntryKind.ParentDelivery, runId: "run-1", messageId: null, payload: null, occurredAt: new Date("2026-08-12T10:00:00.000Z"), runEvent: null, message: null, agentThreadDelivery: { ...saved, kind: AgentThreadDeliveryKind.Result } };
		const replay = new PrismaConversationReplayRepository({
			orgMembership: { findFirst: vi.fn().mockResolvedValue({ clusterTenant: "silo-1" }) },
			conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ visibleFromPosition: 1n, accessEndedPosition: null, conversation: { siloId: "silo-1" } }) },
			conversationTimelineEntry: { findMany: vi.fn().mockResolvedValue([timeline]) },
		} as never);
		const projected = await replay.readAuthorized({ conversationId: "parent-1", siloId: "silo-1", subjectId: "user-1", cursor: null, limit: 20 });

		expect(projected).toEqual({ status: ConversationProjectionReadStatuses.Authorized, rows: [expect.objectContaining({ conversationId: "parent-1", runId: "run-1", type: "conversation.agent_thread.parent_delivery", payload: { id: expect.any(String), childConversationId: "child-1", kind: AgentThreadDeliveryKind.Result, label: "Done", detail: "The requested work is ready.", assetId: null } })] });
	});
});
