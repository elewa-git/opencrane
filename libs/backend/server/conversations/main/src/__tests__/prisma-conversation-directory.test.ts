import { AgentRevisionState, AgentServiceKind, AgentServiceState, PersonaRevisionState, type Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { PrismaConversationMetadataUnitOfWork } from "../prisma-conversation-metadata";

const _authorization = vi.hoisted(function _AuthorizationSpies()
{
	return { listPrincipalEntitled: vi.fn(), reconcileManagedResourceGrants: vi.fn() };
});

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return {
		PrismaAuthorizationAuthority: class
		{
			async listPrincipalEntitled(command: object) { return _authorization.listPrincipalEntitled(command); }
		},
		PrismaManagedAuthorizationGrantRepository: class
		{
			async reconcileManagedResourceGrants(command: object) { return _authorization.reconcileManagedResourceGrants(command); }
		},
	};
});

/** Builds a directory fixture with two members whose read grants cover their own assistants. */
function _Fixture()
{
	const callers = [1, 2].map(index => ({ siloId: "silo-1", principalId: `principal-${index}`, issuer: "https://issuer.test", subjectId: `user-${index}` }));
	const services = [1, 2].map(index => ({ id: `agent-${index}`, name: `Assistant ${index}`, personaRevisionId: `persona-${index}` }));
	const transaction = {
		orgMembership: {
			count: vi.fn().mockResolvedValue(1),
			findMany: vi.fn().mockResolvedValue([1, 2].map(index => ({ id: `member-${index}`, subject: `user-${index}` }))),
		},
		personaProfile: {
			findUnique: vi.fn(async function _Persona(query: Prisma.PersonaProfileFindUniqueArgs)
			{
				const owner = query.where.siloId_userId;
				if (owner?.siloId !== "silo-1")
					return null;
				return { activeRevision: { id: owner.userId.replace("user-", "persona-"), state: PersonaRevisionState.Approved, approvedAt: new Date("2026-09-01") } };
			}),
		},
		agentService: {
			findMany: vi.fn(async function _Services(query: Prisma.AgentServiceFindManyArgs)
			{
				expect(query.where).toMatchObject({ siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: { not: null }, activeRevision: { is: { siloId: "silo-1", state: AgentRevisionState.Published } } });
				const revision = query.where?.activeRevision?.is?.personaRevisionId;
				return services.filter(service => service.personaRevisionId === revision).slice(0, query.take ?? services.length).map(({ id, name }) => ({ id, name }));
			}),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Read(work: (value: typeof transaction) => Promise<unknown>) { return work(transaction); }) };
	const authority = new PrismaConversationMetadataUnitOfWork(prisma as never, {} as never);
	return { authority, callers, transaction, services };
}

describe("caller-owned personal assistant directory", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		_authorization.listPrincipalEntitled.mockImplementation(async function _OwnRead(command: { principalId: string; resources: readonly ProductAuthorizationResourceLocator[] })
		{
			return command.resources.filter(resource => resource.id === command.principalId.replace("principal-", "agent-"));
		});
	});

	it("returns each member's own assistant without requesting access to the other assistant", async function _TwoMembers()
	{
		const { authority, callers } = _Fixture();
		for (const [index, caller] of callers.entries())
		{
			const directory = await authority.directory(caller);
			expect(directory).toEqual({ participants: [{ participantRef: "member-1", isSelf: index === 0 }, { participantRef: "member-2", isSelf: index === 1 }], personalAgentStatus: "ready", personalAgent: { personalAgentRef: `agent-${index + 1}`, displayName: `Assistant ${index + 1}` } });
			expect(_authorization.listPrincipalEntitled).toHaveBeenLastCalledWith(expect.objectContaining({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.AgentService, id: `agent-${index + 1}` }] }));
		}
		expect(_authorization.reconcileManagedResourceGrants).not.toHaveBeenCalled();
	});

	it("keeps an administrator's readable foreign assistant out of personal selection", async function _BroaderRead()
	{
		const { authority, callers } = _Fixture();
		_authorization.listPrincipalEntitled.mockImplementation(async function _AllRead(command: { resources: readonly ProductAuthorizationResourceLocator[] }) { return command.resources; });
		await expect(authority.directory(callers[0]!)).resolves.toMatchObject({ personalAgentStatus: "ready", personalAgent: { personalAgentRef: "agent-1" } });
	});

	it("hides the caller's assistant after its read permission is revoked", async function _RevokedRead()
	{
		const { authority, callers } = _Fixture();
		_authorization.listPrincipalEntitled.mockResolvedValue([]);
		await expect(authority.directory(callers[0]!)).resolves.toMatchObject({ personalAgentStatus: "unavailable", personalAgent: null });
	});

	it("does not search other members' assistants when the caller has no approved persona", async function _NoPersona()
	{
		const { authority, callers, transaction } = _Fixture();
		transaction.personaProfile.findUnique.mockResolvedValue(null);
		await expect(authority.directory(callers[0]!)).resolves.toMatchObject({ personalAgentStatus: "unavailable", personalAgent: null });
		expect(transaction.agentService.findMany).not.toHaveBeenCalled();
	});

	it("reports two readable services for the same current persona as ambiguous", async function _DuplicateOwnedServices()
	{
		const { authority, callers, services } = _Fixture();
		services.push({ id: "agent-duplicate", name: "Duplicate", personaRevisionId: "persona-1" });
		_authorization.listPrincipalEntitled.mockImplementation(async function _AllRead(command: { resources: readonly ProductAuthorizationResourceLocator[] }) { return command.resources; });
		await expect(authority.directory(callers[0]!)).resolves.toMatchObject({ personalAgentStatus: "ambiguous", personalAgent: null });
	});

	it("stops before loading any directory data after organisation membership ends", async function _InactiveMember()
	{
		const { authority, callers, transaction } = _Fixture();
		transaction.orgMembership.count.mockResolvedValue(0);
		await expect(authority.directory(callers[0]!)).rejects.toThrow("conversation directory unavailable");
		expect(transaction.personaProfile.findUnique).not.toHaveBeenCalled();
		expect(transaction.orgMembership.findMany).not.toHaveBeenCalled();
		expect(_authorization.listPrincipalEntitled).not.toHaveBeenCalled();
	});
});
