import { ConversationLifecycle, OrgMemberStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import { PrismaConversationMetadataUnitOfWork } from "../prisma-conversation-metadata";

const _authorization = vi.hoisted(function _Authorization()
{
	return { admit: vi.fn(), canAccess: vi.fn(), reconcileParticipants: vi.fn(), reconcileCreator: vi.fn() };
});
vi.mock("../db/conversation-product-authorization", function _MockAuthorization()
{
	return { PrismaConversationProductAuthorizationRepository: class
	{
		public admit = _authorization.admit;
		public canAccess = _authorization.canAccess;
		public reconcileParticipants = _authorization.reconcileParticipants;
		public reconcileCreator = _authorization.reconcileCreator;
	} };
});

/** Represents the verified caller and two distinct browser creation commands. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1", subjectId: "user-1" };
const _KEY = "57de859d-1fb6-4782-aa0b-2b3d4dfd2292";
const _NEXT_KEY = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Simulates unique PostgreSQL identity and returns real generated enum values. */
function _Fixture()
{
	const rows = new Map<string, any>();
	const members = [1, 2, 3].map(index => ({ id: `member-${index}`, subject: `user-${index}`, status: OrgMemberStatus.Active as OrgMemberStatus }));
	const control = { active: true, loseResponse: false };
	const transaction = {
		conversationChildRequest: { findUnique: vi.fn().mockResolvedValue(null) },
		orgMembership: {
			count: vi.fn(async function _CurrentMember() { return control.active ? 1 : 0; }),
			findMany: vi.fn(async function _Members({ where }: any)
			{
				if (where.clusterTenant !== _CALLER.siloId)
					return [];
				return members.filter(member => (where.status === undefined || member.status === where.status) && (where.id === undefined || where.id.in.includes(member.id)) && (where.subject === undefined || where.subject.in.includes(member.subject)));
			}),
		},
		conversation: {
			findUnique: vi.fn(async function _Existing({ where }: any) { return rows.get(where.id) ?? null; }),
			create: vi.fn(async function _Create({ data }: any)
			{
				if (rows.has(data.id))
					throw new Prisma.PrismaClientKnownRequestError("duplicate conversation", { code: "P2002", clientVersion: "test" });
				const row = { ...data, agentServiceId: null, lifecycle: ConversationLifecycle.Open, updatedAt: new Date("2026-09-07T00:00:00Z"), participants: data.participants.create.map((participant: any) => ({ ...participant, archivedAt: null, accessEndedPosition: null })) };
				rows.set(data.id, row);
				return row;
			}),
		},
		conversationParticipant: {
			findFirst: vi.fn(async function _Detail({ where }: any)
			{
				const conversation = rows.get(where.conversationId);
				if (conversation?.siloId !== where.conversation.siloId)
					return null;
				const participant = conversation.participants.find((item: any) => item.userId === where.userId && item.accessEndedPosition === null);
				return participant === undefined ? null : { ...participant, conversation };
			}),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => Promise<unknown>)
	{
		const result = await work(transaction);
		if (control.loseResponse && typeof result === "object" && result !== null)
		{
			control.loseResponse = false;
			throw new Error("creation committed but response was lost");
		}
		return result;
	}) };
	const genesis = vi.fn().mockResolvedValue(undefined);
	const resolver = { resolve: vi.fn(), createOrdinaryGenesis: genesis };
	const authority = new PrismaConversationMetadataUnitOfWork(prisma as never, resolver);
	return { authority, prisma, transaction, rows, members, control, genesis, resolver };
}

/** Builds an ordinary creation request without accepting caller identity from its body. */
function _Command(mode: ConversationModes.Direct | ConversationModes.Group = ConversationModes.Group)
{
	return { mode, participantRefs: ["member-2"], idempotencyKey: _KEY };
}

describe("ordinary conversation creation commands", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		_authorization.admit.mockResolvedValue(true);
		_authorization.canAccess.mockResolvedValue(true);
	});

	it.each([ConversationModes.Direct, ConversationModes.Group] as const)("recovers %s creation after a lost response and starts a new conversation for a new key", async function _Replay(mode)
	{
		const fixture = _Fixture();
		fixture.control.loseResponse = true;
		await expect(fixture.authority.create(_CALLER, _Command(mode))).rejects.toThrow("response was lost");
		const replay = await fixture.authority.create(_CALLER, _Command(mode));
		expect(replay).toMatchObject({ mode, lifecycle: ConversationLifecycles.Open, participantRefs: ["member-1", "member-2"] });
		expect(fixture.transaction.conversation.create).toHaveBeenCalledTimes(1);
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
		const next = await fixture.authority.create(_CALLER, { ..._Command(mode), idempotencyKey: _NEXT_KEY });
		expect(next?.id).not.toBe(replay?.id);
		expect(fixture.rows.size).toBe(2);
		expect(fixture.resolver.resolve).not.toHaveBeenCalled();
	});

	it("converges concurrent matching requests after a unique-identity rollback", async function _ConcurrentReplay()
	{
		const fixture = _Fixture();
		const [first, second] = await Promise.all([fixture.authority.create(_CALLER, _Command()), fixture.authority.create(_CALLER, _Command())]);
		expect(first?.id).toBe(second?.id);
		expect(first).not.toBeNull();
		expect(fixture.rows.size).toBe(1);
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
		expect(_authorization.reconcileCreator).toHaveBeenCalledTimes(1);
		expect(fixture.transaction.conversation.create).toHaveBeenCalledTimes(2);
	});

	it("rejects a competing member set after the other request commits", async function _ConflictingRace()
	{
		const fixture = _Fixture();
		const results = await Promise.all([fixture.authority.create(_CALLER, _Command()), fixture.authority.create(_CALLER, { ..._Command(), participantRefs: ["member-3"] })]);
		expect(results.filter(result => result !== null)).toHaveLength(1);
		expect(fixture.rows.size).toBe(1);
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
	});

	it("accepts reordered members but rejects changed mode or membership for a committed key", async function _ChangedRequest()
	{
		const fixture = _Fixture();
		const original = await fixture.authority.create(_CALLER, { ..._Command(), participantRefs: ["member-2", "member-3"] });
		await expect(fixture.authority.create(_CALLER, { ..._Command(), participantRefs: ["member-3", "member-2"] })).resolves.toEqual(original);
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
		await expect(fixture.authority.create(_CALLER, _Command(ConversationModes.Direct))).resolves.toBeNull();
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
	});

	it("does not reopen, unarchive, or rewrite participant positions on a retry", async function _ClosedReplay()
	{
		const fixture = _Fixture();
		const first = await fixture.authority.create(_CALLER, _Command());
		const row = fixture.rows.get(first!.id);
		row.lifecycle = ConversationLifecycle.Closed;
		row.participants[0].archivedAt = new Date("2026-09-07T01:00:00Z");
		row.participants[0].readThroughPosition = 8n;
		const replay = await fixture.authority.create(_CALLER, _Command());
		expect(replay).toMatchObject({ id: first!.id, mode: ConversationModes.Group, lifecycle: ConversationLifecycles.Closed, readThroughPosition: "8", archivedAt: "2026-09-07T01:00:00.000Z" });
		expect(fixture.transaction.conversation.create).toHaveBeenCalledTimes(1);
		expect(_authorization.reconcileCreator).toHaveBeenCalledTimes(1);
	});

	it("keeps revoked read access and ended participation closed on a retry", async function _RevokedReplay()
	{
		const fixture = _Fixture();
		const first = await fixture.authority.create(_CALLER, _Command());
		_authorization.canAccess.mockResolvedValue(false);
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
		_authorization.canAccess.mockResolvedValue(true);
		fixture.rows.get(first!.id).participants[0].accessEndedPosition = 2n;
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
		expect(_authorization.reconcileParticipants).toHaveBeenCalledTimes(1);
	});

	it("leaves the member set unaccepted after genesis alone and binds the first PostgreSQL commit", async function _GenesisOnlyFailure()
	{
		const fixture = _Fixture();
		fixture.transaction.conversation.create.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(fixture.authority.create(_CALLER, _Command())).rejects.toThrow("database unavailable");
		expect(fixture.rows.size).toBe(0);
		expect(fixture.genesis).toHaveBeenCalledTimes(1);
		const accepted = await fixture.authority.create(_CALLER, { ..._Command(), participantRefs: ["member-3"] });
		expect(accepted?.participantRefs).toEqual(["member-1", "member-3"]);
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
	});

	it.each([undefined, "not-a-uuid", "", 42])("rejects invalid key %s before history or database work", async function _InvalidKey(idempotencyKey)
	{
		const fixture = _Fixture();
		await expect(fixture.authority.create(_CALLER, { ..._Command(), idempotencyKey })).resolves.toBeNull();
		expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
		expect(fixture.genesis).not.toHaveBeenCalled();
	});

	it("rejects foreign, inactive, self, and repeated selections before history", async function _InvalidSelection()
	{
		const fixture = _Fixture();
		fixture.members[2]!.status = OrgMemberStatus.Suspended;
		for (const participantRefs of [["foreign-member"], ["member-3"], ["member-1"], ["member-2", "member-2"]])
			await expect(fixture.authority.create(_CALLER, { ..._Command(), participantRefs })).resolves.toBeNull();
		expect(fixture.genesis).not.toHaveBeenCalled();
	});

	it("denies missing creation permission before immutable history", async function _DeniedCreate()
	{
		const fixture = _Fixture();
		_authorization.admit.mockResolvedValue(false);
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
		expect(fixture.genesis).not.toHaveBeenCalled();
		expect(fixture.rows.size).toBe(0);
	});

	it("rechecks caller membership after history without creating a projection or grants", async function _RevokedBeforeProjection()
	{
		const fixture = _Fixture();
		fixture.genesis.mockImplementationOnce(async function _Revoke() { fixture.control.active = false; });
		await expect(fixture.authority.create(_CALLER, _Command())).resolves.toBeNull();
		expect(fixture.rows.size).toBe(0);
		expect(_authorization.reconcileParticipants).not.toHaveBeenCalled();
	});
});
