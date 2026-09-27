import { ConversationLifecycle, OrgMemberStatus, PrincipalProvenance } from "@prisma/client";

import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { beforeEach, describe, expect, it, vi } from "vitest";

const _authorization = vi.hoisted(function _AuthorizationSpies()
{
	return { decidePrincipal: vi.fn(), listPrincipalEntitled: vi.fn() };
});

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return {
		PrismaAuthorizationAuthority: class
		{
			async decidePrincipal(command: object) { return _authorization.decidePrincipal(command); }
			async listPrincipalEntitled(command: object) { return _authorization.listPrincipalEntitled(command); }
		},
	};
});

import { PrismaRoutineConversationDirectoryRepository } from "../prisma-routine-conversation-directory";
import type { RoutineDirectoryCaller } from "../routine-conversation-directory.types";

/** Stable caller coordinates used by all directory operations. */
const _CALLER: RoutineDirectoryCaller = { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.example", subjectId: "subject-1" };
/** Database time used for current participation and authorization decisions. */
const _NOW = new Date("2026-09-27T10:00:00.000Z");

/** Builds a narrow transaction fixture with mutable participation and authorization state. */
function _Fixture()
{
	const state: { members: Array<{ readonly id: string; readonly subject: string; readonly displayName: string | null }>; principals: Array<{ readonly id: string; readonly issuer: string; readonly subject: string }>; participants: Array<{ readonly userId: string; readonly accessEndedPosition: bigint | null }>; conversation: boolean; readable: Set<string> } = {
		members: [{ id: "member-1", subject: "subject-1", displayName: " Jente " }, { id: "member-2", subject: "subject-2", displayName: "Amina" }],
		principals: [{ id: "principal-1", issuer: "https://issuer.example", subject: "subject-1" }, { id: "principal-2", issuer: "https://issuer.example", subject: "subject-2" }],
		participants: [{ userId: "subject-1", accessEndedPosition: null }, { userId: "subject-2", accessEndedPosition: null }],
		conversation: true,
		readable: new Set(["conversation-1"]),
	};
	const transaction = {
		principal: {
			findFirst: vi.fn(async function _FindCaller() { return state.principals.some(row => row.id === _CALLER.principalId && row.subject === _CALLER.subjectId) ? { id: _CALLER.principalId } : null; }),
			findMany: vi.fn(async function _FindPrincipals() { return state.principals; }),
		},
		conversation: {
			findFirst: vi.fn(async function _FindDestination() { return state.conversation ? { participants: state.participants.filter(row => row.accessEndedPosition === null).map(row => ({ userId: row.userId })) } : null; }),
			findMany: vi.fn(async function _FindReadable() { return [...state.readable].map(id => ({ id })); }),
		},
		orgMembership: { findMany: vi.fn(async function _FindMembers() { return state.members; }) },
	};
	const repository = new PrismaRoutineConversationDirectoryRepository(transaction as never);
	return { repository, transaction, state };
}

describe("PrismaRoutineConversationDirectoryRepository", function _Suite()
{
	beforeEach(function _ResetAuthorization()
	{
		vi.clearAllMocks();
		_authorization.decidePrincipal.mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow });
		_authorization.listPrincipalEntitled.mockImplementation(async function _List(command: { resources: readonly { id: string }[] })
		{
			return command.resources.filter(resource => resource.id === "conversation-1");
		});
	});

	it("resolves active destination participants to sorted current Principals", async function _ResolveAudience()
	{
		const fixture = _Fixture();

		await expect(fixture.repository.resolveAudience(_CALLER, "conversation-1", ["member-2", "member-1"], _NOW)).resolves.toEqual({ participantRefs: ["member-1", "member-2"], principalIds: ["principal-1", "principal-2"] });
	});

	it.each([
		["foreign silo", { members: [{ id: "member-1", subject: "subject-1", displayName: "Jente" }] }],
		["inactive destination", { conversation: false }],
		["non-destination participant", { participants: [{ userId: "subject-1", accessEndedPosition: null }] }],
		["duplicate participant references", { refs: ["member-1", "member-1"] }],
		["missing caller self", { members: [{ id: "member-2", subject: "subject-2", displayName: "Amina" }], refs: ["member-2"] }],
		["subject substitution", { members: [{ id: "member-1", subject: "subject-2", displayName: "Jente" }], principals: [{ id: "principal-1", subject: "subject-2" }] }],
	])("denies %s during strict audience resolution", async function _RejectsAudience(_label, patch)
	{
		const fixture = _Fixture();
		Object.assign(fixture.state, patch);
		const refs = "refs" in patch ? patch.refs : ["member-1"];

		await expect(fixture.repository.resolveAudience(_CALLER, "conversation-1", refs, _NOW)).resolves.toBeNull();
	});

	it("returns eligible creation choices with safe labels only", async function _CreationOptions()
	{
		const fixture = _Fixture();

		await expect(fixture.repository.creationAudience(_CALLER, "conversation-1", _NOW)).resolves.toEqual([{ participantRef: "member-1", displayName: "Jente", isSelf: true }, { participantRef: "member-2", displayName: "Amina", isSelf: false }]);
		const result = await fixture.repository.creationAudience(_CALLER, "conversation-1", _NOW);
		expect(JSON.stringify(result)).not.toContain("subject-");
		expect(JSON.stringify(result)).not.toContain("principal-");
	});

	it("projects retired frozen Principals even when another audience member is inactive", async function _ProjectRetiredAudience()
	{
		const fixture = _Fixture();
		fixture.state.members = [{ id: "member-1", subject: "subject-1", displayName: " Jente " }, { id: "member-2", subject: "subject-2", displayName: null }];

		await expect(fixture.repository.projectAudience(_CALLER, "conversation-1", ["principal-2", "principal-1"])).resolves.toEqual([{ participantRef: "member-1", displayName: "Jente", isSelf: true }, { participantRef: "member-2", displayName: "Unnamed member", isSelf: false }]);
	});

	it("rejects a frozen Principal from another issuer during historical projection", async function _ProjectForeignIssuer()
	{
		const fixture = _Fixture();
		fixture.state.principals = [{ id: "principal-1", issuer: _CALLER.issuer, subject: "subject-1" }, { id: "principal-2", issuer: "https://other-issuer.example", subject: "subject-2" }];

		await expect(fixture.repository.projectAudience(_CALLER, "conversation-1", ["principal-1", "principal-2"])).rejects.toThrow("incomplete or ambiguous");
	});

	it("filters readable occurrence conversations through current participation and Conversation Read", async function _ReadableConversations()
	{
		const fixture = _Fixture();
		fixture.state.readable = new Set(["conversation-2", "conversation-1"]);
		fixture.state.participants = [{ userId: "subject-1", accessEndedPosition: null }];
		_authorization.listPrincipalEntitled.mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }]);

		await expect(fixture.repository.readableConversationIds(_CALLER, ["conversation-1", "conversation-2"], _NOW)).resolves.toEqual(["conversation-1"]);
		expect(_authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Read }));
	});
});
