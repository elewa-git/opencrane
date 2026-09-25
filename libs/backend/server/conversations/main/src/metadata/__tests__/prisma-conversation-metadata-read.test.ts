import { ConversationLifecycle, ConversationMode, OrgMemberStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import { PrismaConversationMetadataReader } from "../prisma-conversation-metadata-reader";

const _authorization = vi.hoisted(function _Authorization()
{
	return { canAccess: vi.fn(), entitledIds: vi.fn() };
});
vi.mock("../../authorization/db/conversation-product-authorization", function _MockAuthorization()
{
	return { PrismaConversationProductAuthorizationRepository: class
	{
		public canAccess = _authorization.canAccess;
		public entitledIds = _authorization.entitledIds;
	} };
});

const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "private-user-1" };

/** Retains a historical suspended peer while applying the caller's current membership and participation filters. */
function _Fixture(mode: ConversationMode = ConversationMode.Group, lifecycle: ConversationLifecycle = ConversationLifecycle.Open)
{
	const members = [{ id: "member-1", subject: _CALLER.subjectId, status: OrgMemberStatus.Active }, { id: "member-2", subject: "private-user-2", status: OrgMemberStatus.Suspended }];
	const control = { active: true, accessEndedPosition: null as bigint | null };
	const conversation = { id: "conversation-1", siloId: _CALLER.siloId, mode, lifecycle, agentServiceId: null, updatedAt: new Date("2026-09-07T00:00:00Z"), participants: members.map(member => ({ userId: member.subject })) };
	const participant = { conversationId: conversation.id, userId: _CALLER.subjectId, visibleFromPosition: 0n, readThroughPosition: 4n, archivedAt: null, accessEndedPosition: null, conversation };
	function _Rows(where: any)
	{
		return where.userId === _CALLER.subjectId && where.accessEndedPosition === control.accessEndedPosition && where.conversation.siloId === _CALLER.siloId ? [participant] : [];
	}
	const transaction = {
		conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) },
		orgMembership: {
			count: vi.fn(async function _Active({ where }: any)
			{
				return control.active && where.clusterTenant === _CALLER.siloId && where.subject === _CALLER.subjectId && where.status === OrgMemberStatus.Active ? 1 : 0;
			}),
			findMany: vi.fn(async function _References({ where }: any)
			{
				if (where.clusterTenant !== _CALLER.siloId)
					return [];
				return members.filter(member => where.subject.in.includes(member.subject) && (where.status === undefined || where.status === member.status));
			}),
		},
		conversationParticipant: {
			findMany: vi.fn(async function _List({ where }: any) { return _Rows(where); }),
			findFirst: vi.fn(async function _Detail({ where }: any) { return where.conversationId === conversation.id ? _Rows(where)[0] ?? null : null; }),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Read(work: (value: typeof transaction) => Promise<unknown>) { return work(transaction); }) };
	const authority = new PrismaConversationMetadataReader(prisma as never);
	return { authority, transaction, members, control, conversation };
}

describe("participant metadata after membership changes", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		_authorization.canAccess.mockResolvedValue(true);
		_authorization.entitledIds.mockResolvedValue(new Set(["conversation-1"]));
	});

	it("keeps an authorized group readable when another member is suspended", async function _SuspendedPeer()
	{
		const { authority, transaction } = _Fixture();
		await expect(authority.list(_CALLER, false)).resolves.toMatchObject([{ participantRefs: ["member-1", "member-2"] }]);
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toMatchObject({ participantRefs: ["member-1", "member-2"] });
		expect(transaction.orgMembership.findMany).toHaveBeenCalledWith({ where: { clusterTenant: "silo-1", subject: { in: [_CALLER.subjectId, "private-user-2"] } }, select: { id: true, subject: true } });
	});

	it("omits a physically missing membership without exposing its subject or failing the group", async function _DeletedPeer()
	{
		const { authority, members } = _Fixture();
		members.pop();
		const list = await authority.list(_CALLER, false);
		const detail = await authority.open(_CALLER, "conversation-1");
		expect(list).toMatchObject([{ participantRefs: ["member-1"] }]);
		expect(detail).toMatchObject({ participantRefs: ["member-1"] });
		expect(JSON.stringify({ list, detail })).not.toContain("private-user");
	});

	it("still refuses the list and detail after the caller's membership ends", async function _InactiveCaller()
	{
		const { authority, control, transaction } = _Fixture();
		control.active = false;
		await expect(authority.list(_CALLER, false)).rejects.toThrow("conversation list unavailable");
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toBeNull();
		expect(transaction.conversationParticipant.findMany).not.toHaveBeenCalled();
		expect(transaction.conversationParticipant.findFirst).not.toHaveBeenCalled();
		expect(transaction.orgMembership.findMany).not.toHaveBeenCalled();
	});

	it("still filters a caller whose conversation participation has ended", async function _EndedParticipation()
	{
		const { authority, control } = _Fixture();
		control.accessEndedPosition = 7n;
		await expect(authority.list(_CALLER, false)).resolves.toEqual([]);
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toBeNull();
	});

	it("still requires current central Read authorization", async function _RevokedRead()
	{
		const { authority } = _Fixture();
		_authorization.canAccess.mockResolvedValue(false);
		_authorization.entitledIds.mockResolvedValue(new Set());
		await expect(authority.list(_CALLER, false)).resolves.toEqual([]);
		await expect(authority.open(_CALLER, "conversation-1")).resolves.toBeNull();
	});

	it.each([
		[ConversationMode.AgentSession, ConversationModes.AgentSession],
		[ConversationMode.Direct, ConversationModes.Direct],
		[ConversationMode.Group, ConversationModes.Group],
	] as const)("converts generated Prisma %s mode and both lifecycle values into the public contract", async function _WireEnums(mode, wireMode)
	{
		for (const [lifecycle, wireLifecycle] of [[ConversationLifecycle.Open, ConversationLifecycles.Open], [ConversationLifecycle.Closed, ConversationLifecycles.Closed]] as const)
		{
			const { authority } = _Fixture(mode, lifecycle);
			await expect(authority.list(_CALLER, false)).resolves.toMatchObject([{ mode: wireMode, lifecycle: wireLifecycle }]);
			await expect(authority.open(_CALLER, "conversation-1")).resolves.toMatchObject({ mode: wireMode, lifecycle: wireLifecycle });
		}
	});
});
