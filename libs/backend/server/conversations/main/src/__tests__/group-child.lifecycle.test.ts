import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationChildRequestState, ConversationMode } from "@prisma/client";
import { PrismaGroupChildLifecycleUnitOfWork } from "../prisma-group-child-lifecycle";
import { GroupChildConflictError } from "../group-child.errors";
import { AesGcmConversationPrivatePayloadCipher } from "../conversation-private-payload-cipher";
import { PrismaGroupChildAccessRepository } from "../db/prisma-group-child-access-repository";
import type { ConversationCaller } from "../types/conversation-caller.types";

const _authorization = vi.hoisted(() => ({ canAccess: vi.fn(), isCurrentlyEligible: vi.fn(), admit: vi.fn(), reconcileParticipants: vi.fn(), reconcileCreator: vi.fn() }));
vi.mock("../db/conversation-product-authorization", () => ({ PrismaConversationProductAuthorizationRepository: class { canAccess = _authorization.canAccess; isCurrentlyEligible = _authorization.isCurrentlyEligible; admit = _authorization.admit; reconcileParticipants = _authorization.reconcileParticipants; reconcileCreator = _authorization.reconcileCreator; } }));
const _CALLER: ConversationCaller = { siloId: "silo", principalId: "principal", subjectId: "subject", externalIssuer: "https://issuer.test", verifiedAuthenticationAt: "2026-09-07T00:00:00.000Z" };
const _KEY = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _SOURCE = "41c1f1dc-0010-4f13-9c2f-d3841ffd6651";
const _COMMAND = { parentMessageId: _SOURCE, parentMessagePosition: "5", agentServiceId: "company", idempotencyKey: _KEY };

/** Models committed request, projection and encrypted payload stages so retries observe the prior writes. */
function _Fixture()
{
	const state = { request: null as any, child: null as any, payload: null as any, joinedAt: 1n, callerJoinedAt: 1n, lateJoinedAt: null as bigint | null, active: true, parentExists: true, sourceVisible: true, sourceAuthor: "principal", sourceAudience: "conversation" };
	const transaction = {
		principal: { findFirst: vi.fn(async () => ({ id: "principal" })), findMany: vi.fn(async () => [{ id: "principal", subject: "subject" }, { id: "peer-principal", subject: "peer" }]) },
		orgMembership: { findMany: vi.fn(async () => state.active ? [{ subject: "subject" }, { subject: "peer" }] : []), findUnique: vi.fn(async () => ({ status: "Active", displayName: "Human" })) },
		conversation: {
			findFirst: vi.fn(async () =>
			{
				if (!state.parentExists)
					return null;
				const participants = [{ userId: "subject", visibleFromPosition: state.callerJoinedAt }, { userId: "peer", visibleFromPosition: state.joinedAt }];
				if (state.lateJoinedAt !== null)
					participants.push({ userId: "later-peer", visibleFromPosition: state.lateJoinedAt });
				return { id: "parent", participants };
			}),
			findUnique: vi.fn(async () => state.child),
			create: vi.fn(async ({ data }: any) => { state.child = { ...data, lifecycle: "Open", participants: data.participants.create }; return state.child; }),
			update: vi.fn(async () => ({ id: state.child.id })),
		},
		conversationChildRequest: {
			findUnique: vi.fn(async ({ where }: any) => state.request !== null && (where.id === state.request.id || where.childConversationId === state.request.childConversationId) ? state.request : null),
			findMany: vi.fn(async () => state.request ? [state.request] : []),
			create: vi.fn(async ({ data }: any) => { state.request = { ...data, state: ConversationChildRequestState.Pending, createdAt: new Date("2026-09-07T00:00:00.000Z") }; return state.request; }),
			updateMany: vi.fn(async ({ data }: any) => { state.request = { ...state.request, ...data }; return { count: 1 }; }),
		},
		conversationPrivatePayload: {
			findUnique: vi.fn(async () => state.payload),
			create: vi.fn(async ({ data }: any) => { state.payload = data; return data; }),
		},
	};
	const prisma = { ...transaction, $transaction: vi.fn(async (work: any) => work(transaction)) };
	const histories = { establish: vi.fn(async () => undefined), activate: vi.fn(async () => undefined) };
	const cipher = new AesGcmConversationPrivatePayloadCipher("key", { key: Buffer.alloc(32, 7).toString("base64url") });
	const agents = { resolve: vi.fn(async () => ({ agentServiceId: "company", agentRevisionId: "revision", agentIdentityId: "managed-company", principalId: "company-principal", name: "Company assistant", workloadProfile: "standard", profileRevisionId: "profile" })) };
	const workflows = { spawn: vi.fn(async () => ({ taskId: "task", taskName: "task", idempotencyKey: "key" })) };
	const participantHistory = { read: vi.fn(async () => state.sourceVisible ? { entries: [{ id: _SOURCE, position: "5", kind: "message", state: "completed", blocks: [{ kind: "text", payloadRef: "source" }], author: { kind: "human", principalId: state.sourceAuthor, participantId: "subject" }, visibility: { audience: state.sourceAudience } }], payloads: { source: "Visible group request" }, nextPosition: "5", computer: null } : null) };
	const lifecycle = new PrismaGroupChildLifecycleUnitOfWork(prisma as never, histories as never, cipher, agents, workflows, participantHistory as never);
	return { lifecycle, state, transaction, histories, workflows, participantHistory, agents };
}

describe("shared group child lifecycle", () =>
{
	beforeEach(() => { vi.clearAllMocks(); _authorization.canAccess.mockResolvedValue(true); _authorization.isCurrentlyEligible.mockResolvedValue(true); _authorization.admit.mockResolvedValue(true); });
	it("commits one immutable command with its workflow and recovers a lost response without another request", async () =>
	{
		const f = _Fixture();
		const first = await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		const second = await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		expect(second).toEqual(first);
		expect(first?.state).toBe("pending");
		expect(f.transaction.conversationChildRequest.create).toHaveBeenCalledTimes(1);
		expect(f.workflows.spawn).toHaveBeenCalledWith({ client: f.transaction }, expect.objectContaining({ input: { requestId: f.state.request.id, siloId: "silo" } }));
		expect(JSON.stringify(f.state.request, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toContain("Visible group request");
		await expect(f.lifecycle.create(_CALLER, "parent", { ..._COMMAND, agentServiceId: "different" })).rejects.toBeInstanceOf(GroupChildConflictError);
	});
	it.each(["pending", "ready"])("recovers a %s request after a later group join without expanding the frozen child audience", async phase =>
	{
		const f = _Fixture();
		await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		if (phase === "ready")
			await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
		f.state.lateJoinedAt = 6n;
		const recovered = await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		expect(recovered?.state).toBe(phase);
		expect(f.state.request.participantSubjectIds).toEqual(["peer", "subject"]);
		expect(f.transaction.conversationChildRequest.create).toHaveBeenCalledTimes(1);
		expect(f.workflows.spawn).toHaveBeenCalledTimes(1);
		if (phase === "pending")
			await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
		expect(f.state.child.participants.map((participant: { userId: string }) => participant.userId)).toEqual(["peer", "subject"]);
		const reads = f.participantHistory.read.mock.calls.length;
		await expect(f.lifecycle.create(_CALLER, "parent", { ..._COMMAND, agentServiceId: "different" })).rejects.toBeInstanceOf(GroupChildConflictError);
		expect(f.participantHistory.read).toHaveBeenCalledTimes(reads);
		expect(await f.lifecycle.create(_CALLER, "parent", { ..._COMMAND, idempotencyKey: "51c1f1dc-0010-4f13-9c2f-d3841ffd6651" })).toBeNull();
		expect(f.participantHistory.read).toHaveBeenCalledTimes(reads);
	});
	it.each(["membership", "join-boundary", "source", "child"])("does not recover an admitted request after current %s access is lost", async revoked =>
	{
		const f = _Fixture();
		await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		if (revoked === "child")
		{
			await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
			_authorization.canAccess.mockImplementation(async (_caller, conversationId) => conversationId !== f.state.request.childConversationId);
		}
		if (revoked === "membership")
			f.state.active = false;
		if (revoked === "join-boundary")
			f.state.callerJoinedAt = 6n;
		if (revoked === "source")
			f.state.sourceVisible = false;
		f.participantHistory.read.mockClear();
		expect(await f.lifecycle.create(_CALLER, "parent", _COMMAND)).toBeNull();
		if (revoked !== "source")
			expect(f.participantHistory.read).not.toHaveBeenCalled();
		expect(f.transaction.conversationChildRequest.create).toHaveBeenCalledTimes(1);
		expect(f.workflows.spawn).toHaveBeenCalledTimes(1);
	});
	it("rechecks a retry after the source read before returning the immutable request", async () =>
	{
		const f = _Fixture();
		await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		const read = f.participantHistory.read.getMockImplementation()!;
		f.participantHistory.read.mockImplementationOnce(async () => { const page = await read(); f.state.active = false; return page; });
		expect(await f.lifecycle.create(_CALLER, "parent", _COMMAND)).toBeNull();
		expect(f.workflows.spawn).toHaveBeenCalledTimes(1);
	});
	it("rejects a pre-join shared audience before decrypting the parent message", async () =>
	{
		const f = _Fixture(); f.state.joinedAt = 6n;
		expect(await f.lifecycle.create(_CALLER, "parent", _COMMAND)).toBeNull();
		expect(f.participantHistory.read).not.toHaveBeenCalled();
		expect(f.workflows.spawn).not.toHaveBeenCalled();
	});
	it.each(["foreign-author", "subset"])("refuses %s source without admitting work", async kind =>
	{
		const f = _Fixture();
		if (kind === "foreign-author")
			f.state.sourceAuthor = "peer-principal";
		else
			f.state.sourceAudience = "participant_subset";
		expect(await f.lifecycle.create(_CALLER, "parent", _COMMAND)).toBeNull();
		expect(f.workflows.spawn).not.toHaveBeenCalled();
	});
	it("requires the separate Delegate and creation decisions", async () =>
	{
		const f = _Fixture(); _authorization.admit.mockResolvedValue(false);
		expect(await f.lifecycle.create(_CALLER, "parent", _COMMAND)).toBeNull();
		expect(f.workflows.spawn).not.toHaveBeenCalled();
	});
	it("establishes cold history before the projection and marks ready only after atomic activation", async () =>
	{
		const f = _Fixture(); await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
		expect(f.state.request.state).toBe(ConversationChildRequestState.Ready);
		expect(f.state.child.mode).toBe(ConversationMode.AgentSession);
		expect(f.state.child.computerAgentIdentityId).toBe("managed-company");
		expect(f.histories.establish.mock.invocationCallOrder[0]).toBeLessThan(f.transaction.conversation.create.mock.invocationCallOrder[0]!);
		expect(f.histories.activate.mock.invocationCallOrder[0]).toBeLessThan(f.transaction.conversationChildRequest.updateMany.mock.invocationCallOrder[0]!);
		expect(f.state.payload.ciphertext.toString()).not.toContain("Visible group request");
	});
	it("resumes after activation failure without rebuilding grants or duplicating the encrypted copy", async () =>
	{
		const f = _Fixture(); await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		f.histories.activate.mockRejectedValueOnce(new Error("dependency lost"));
		await expect(f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id })).rejects.toThrow("dependency");
		await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
		expect(f.state.request.state).toBe(ConversationChildRequestState.Ready);
		expect(f.transaction.conversation.create).toHaveBeenCalledTimes(1);
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
		expect(f.transaction.conversationPrivatePayload.create).toHaveBeenCalledTimes(1);
	});
	it("closes revoked work before cold history, copying or activation", async () =>
	{
		const f = _Fixture(); await f.lifecycle.create(_CALLER, "parent", _COMMAND); f.state.active = false;
		await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id });
		expect(f.state.request.state).toBe(ConversationChildRequestState.Unavailable);
		expect(f.histories.establish).not.toHaveBeenCalled();
		expect(f.transaction.conversationPrivatePayload.create).not.toHaveBeenCalled();
	});
	it("never makes pending children readable and closes ready access when parent membership ends", async () =>
	{
		const f = _Fixture(); await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		expect(await new PrismaGroupChildAccessRepository(f.transaction as never).mayAccess(_CALLER, f.state.request.childConversationId)).toBe(false);
		f.state.request.state = ConversationChildRequestState.Ready; f.state.parentExists = false;
		expect(await new PrismaGroupChildAccessRepository(f.transaction as never).mayAccess(_CALLER, f.state.request.childConversationId)).toBe(false);
	});
	it("makes exhausted dependency retries unavailable instead of leaving a permanent pending request", async () =>
	{
		const f = _Fixture(); await f.lifecycle.create(_CALLER, "parent", _COMMAND);
		f.histories.establish.mockRejectedValue(new Error("still offline"));
		await f.lifecycle.run({ siloId: "silo", requestId: f.state.request.id }, 12);
		expect(f.state.request.state).toBe(ConversationChildRequestState.Unavailable);
		expect(f.histories.activate).not.toHaveBeenCalled();
	});

});
