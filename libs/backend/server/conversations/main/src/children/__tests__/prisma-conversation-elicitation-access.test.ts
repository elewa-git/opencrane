import { ConversationChildRequestState, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaConversationProductAuthorizationRepository } from "../../authorization/db/conversation-product-authorization";
import { PrismaConversationElicitationAccessRepository } from "../db/prisma-conversation-elicitation-access";

/** Build the real sharing adapter over narrowly controlled database and grant reads. */
function _fixture()
{
	const membership = vi.fn().mockResolvedValue(1);
	const participant = vi.fn().mockResolvedValue({ userId: "guest" });
	const principals = vi.fn().mockResolvedValue([{ id: "guest-principal" }]);
	const request = vi.fn().mockResolvedValue({ siloId: "silo", state: ConversationChildRequestState.Ready, parentConversationId: "parent", parentMessagePosition: 8n, participantSubjectIds: ["requester", "guest"] });
	const conversation = vi.fn().mockResolvedValue({ id: "conversation" });
	const grants = vi.spyOn(PrismaConversationProductAuthorizationRepository.prototype, "canAccess").mockResolvedValue(true);
	const transaction = { orgMembership: { count: membership }, conversationParticipant: { findFirst: participant }, principal: { findMany: principals }, conversationChildRequest: { findUnique: request }, conversation: { findFirst: conversation } } as unknown as Prisma.TransactionClient;
	return { membership, participant, principals, request, conversation, grants, adapter: new PrismaConversationElicitationAccessRepository(transaction) };
}

afterEach(function _restore() { vi.restoreAllMocks(); });

describe("PrismaConversationElicitationAccessRepository", function _suite()
{
	it("requires the actual reader's active membership, child participation and both current Read grants", async function _admittedReader()
	{
		const f = _fixture();
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(true);
		expect(f.membership).toHaveBeenCalledWith({ where: { clusterTenant: "silo", subject: "guest", status: OrgMemberStatus.Active } });
		expect(f.participant).toHaveBeenCalledWith({ where: { conversationId: "child", userId: "guest", accessEndedPosition: null, conversation: { siloId: "silo" } }, select: { userId: true } });
		expect(f.principals).toHaveBeenCalledWith({ where: { siloId: "silo", subject: "guest" }, select: { id: true }, take: 2 });
		expect(f.grants.mock.calls.map(call => call[1])).toEqual(["child", "parent"]);
		expect(f.grants.mock.calls[0]?.[0]).toEqual({ siloId: "silo", subjectId: "guest", principalId: "guest-principal" });
		expect(f.conversation).toHaveBeenLastCalledWith({ where: { id: "parent", siloId: "silo", mode: ConversationMode.Group, participants: { some: { userId: "guest", accessEndedPosition: null, visibleFromPosition: { lte: 8n } } } }, select: { id: true } });
	});

	it.each([0, 2])("refuses missing or ambiguous organisation membership (%s)", async function _membership(count)
	{
		const f = _fixture();
		f.membership.mockResolvedValue(count);
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
		expect(f.participant).not.toHaveBeenCalled();
		expect(f.request).not.toHaveBeenCalled();
	});

	it("does not turn parent membership into a child invitation", async function _noChildParticipant()
	{
		const f = _fixture();
		f.participant.mockResolvedValue(null);
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
		expect(f.principals).not.toHaveBeenCalled();
	});

	it.each([{ rows: [] }, { rows: [{ id: "first" }, { id: "second" }] }])("refuses missing or ambiguous local identity", async function _identity({ rows })
	{
		const f = _fixture();
		f.principals.mockResolvedValue(rows);
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
		expect(f.request).not.toHaveBeenCalled();
	});

	it("refuses a participant absent from the frozen child audience", async function _frozenAudience()
	{
		const f = _fixture();
		f.request.mockResolvedValue({ siloId: "silo", state: ConversationChildRequestState.Ready, parentConversationId: "parent", parentMessagePosition: 8n, participantSubjectIds: ["requester"] });
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
		expect(f.grants).not.toHaveBeenCalled();
	});

	it("refuses another silo's child authority", async function _wrongSilo()
	{
		const f = _fixture();
		f.request.mockResolvedValue({ siloId: "other", state: ConversationChildRequestState.Ready, parentConversationId: "parent", parentMessagePosition: 8n, participantSubjectIds: ["guest"] });
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
	});

	it("refuses a child still being prepared", async function _notReady()
	{
		const f = _fixture();
		f.request.mockResolvedValue({ siloId: "silo", state: ConversationChildRequestState.Pending, parentConversationId: "parent", parentMessagePosition: 8n, participantSubjectIds: ["guest"] });
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
	});

	it("refuses a parent source outside the reader's present visibility", async function _sourceVisibility()
	{
		const f = _fixture();
		f.conversation.mockResolvedValueOnce({ id: "child" }).mockResolvedValueOnce(null);
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
		expect(f.grants.mock.calls.map(call => call[1])).toEqual(["child"]);
	});

	it.each(["child", "parent"])("honours a revoked %s Read grant", async function _revokedGrant(denied)
	{
		const f = _fixture();
		f.grants.mockImplementation(async function _allowed(_caller, conversationId) { return conversationId !== denied; });
		await expect(f.adapter.canAccess("silo", "guest", "child")).resolves.toBe(false);
	});

	it("allows ordinary conversation participants without inventing a parent relationship", async function _ordinaryConversation()
	{
		const f = _fixture();
		f.request.mockResolvedValue(null);
		await expect(f.adapter.canAccess("silo", "guest", "conversation")).resolves.toBe(true);
		expect(f.participant).toHaveBeenCalledOnce();
		expect(f.grants).not.toHaveBeenCalled();
	});
});
