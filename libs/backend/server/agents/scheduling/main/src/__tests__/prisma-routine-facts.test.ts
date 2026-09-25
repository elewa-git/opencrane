import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaRoutineFactsRepository } from "../routine-prisma-facts";
import { _CALLER, _Current, _NOW } from "./prisma-routine-test-fixtures";

/** Supplies an allow decision with the evidence required by admitting calls. */
function _Allowed()
{
	return { outcome: AuthorizationDecisionOutcomes.Allow, evidence: { id: "evidence-1" } };
}

/** Builds the narrow authorization authority exercised by routine facts. */
function _Authorization()
{
	return {
		decidePrincipal: vi.fn().mockResolvedValue(_Allowed()),
		admitPrincipal: vi.fn().mockResolvedValue(_Allowed()),
		admitPrincipalBatch: vi.fn().mockResolvedValue([_Allowed(), _Allowed()]),
	};
}

describe("PrismaRoutineFactsRepository", function _Suite()
{
	it("freezes exactly the confirmed external Principals instead of every current participant", async function _ExactAudience()
	{
		const conversation = { participants: [{ userId: "subject-1" }, { userId: "subject-2" }, { userId: "new-unselected-subject" }] };
		const principalFindMany = vi.fn().mockResolvedValue([{ id: "principal-1", subject: "subject-1" }, { id: "principal-2", subject: "subject-2" }]);
		const transaction = { conversation: { findFirst: vi.fn().mockResolvedValue(conversation) }, principal: { findMany: principalFindMany } } as unknown as Prisma.TransactionClient;
		const authorization = _Authorization();
		const repository = new PrismaRoutineFactsRepository(transaction, authorization as unknown as AuthorizationAuthority);

		await expect(repository.resolveCreationAudience(_CALLER, "destination-1", ["principal-2", "principal-1"], _NOW)).resolves.toEqual(["principal-2", "principal-1"]);
		expect(principalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["principal-2", "principal-1"] } }) }));
		expect(authorization.decidePrincipal).toHaveBeenCalledTimes(3);
		expect(authorization.decidePrincipal).not.toHaveBeenCalledWith(expect.objectContaining({ principalId: "new-unselected-principal" }));
	});

	it("rejects a confirmed Principal that is no longer a current destination participant", async function _RemovedAudience()
	{
		const transaction = {
			conversation: { findFirst: vi.fn().mockResolvedValue({ participants: [{ userId: "subject-1" }] }) },
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "subject-1" }, { id: "principal-2", subject: "subject-2" }]) },
		} as unknown as Prisma.TransactionClient;
		const repository = new PrismaRoutineFactsRepository(transaction, _Authorization() as unknown as AuthorizationAuthority);

		await expect(repository.resolveCreationAudience(_CALLER, "destination-1", ["principal-1", "principal-2"], _NOW)).rejects.toThrow("not a current destination participant");
	});

	it("admits one retired-history reader without consulting another frozen audience member", async function _CurrentReader()
	{
		const principalFindFirst = vi.fn().mockResolvedValue({ id: "principal-1" });
		const conversationFindFirst = vi.fn().mockResolvedValue({ id: "destination-1" });
		const transaction = { principal: { findFirst: principalFindFirst }, conversation: { findFirst: conversationFindFirst } } as unknown as Prisma.TransactionClient;
		const authorization = _Authorization();
		const repository = new PrismaRoutineFactsRepository(transaction, authorization as unknown as AuthorizationAuthority);
		const current = _Current();

		await expect(repository.requireCurrentReader(_CALLER, current.routine, current.revision, _NOW)).resolves.toBeUndefined();
		expect(principalFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "principal-1", issuer: _CALLER.issuer, subject: _CALLER.subjectId, provenance: "External" }) }));
		expect(conversationFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "destination-1", participants: { some: { userId: "subject-1", accessEndedPosition: null } } }) }));
		expect(authorization.decidePrincipal).toHaveBeenCalledTimes(2);
		expect(authorization.decidePrincipal).not.toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-2" }));
	});

	it.each([
		["outside the frozen audience", { caller: { ..._CALLER, principalId: "principal-outside" }, principal: { id: "principal-outside" }, conversation: { id: "destination-1" } }],
		["missing exact external Principal", { caller: _CALLER, principal: null, conversation: { id: "destination-1" } }],
		["ended destination participation", { caller: _CALLER, principal: { id: "principal-1" }, conversation: null }],
	])("denies a retired-history reader with %s", async function _RevokedReader(_name, fixture)
	{
		const transaction = { principal: { findFirst: vi.fn().mockResolvedValue(fixture.principal) }, conversation: { findFirst: vi.fn().mockResolvedValue(fixture.conversation) } } as unknown as Prisma.TransactionClient;
		const authorization = _Authorization();
		const repository = new PrismaRoutineFactsRepository(transaction, authorization as unknown as AuthorizationAuthority);
		const current = _Current();

		await expect(repository.requireCurrentReader(fixture.caller, current.routine, current.revision, _NOW)).rejects.toThrow("routine reader no longer has current destination access");
		expect(authorization.decidePrincipal).not.toHaveBeenCalled();
	});

	it.each([
		["routine Read", 0],
		["destination Read", 1],
	])("denies a retired-history reader whose %s grant is revoked", async function _RevokedRead(_name, deniedIndex)
	{
		const transaction = { principal: { findFirst: vi.fn().mockResolvedValue({ id: "principal-1" }) }, conversation: { findFirst: vi.fn().mockResolvedValue({ id: "destination-1" }) } } as unknown as Prisma.TransactionClient;
		const authorization = _Authorization();
		let callIndex = 0;
		authorization.decidePrincipal.mockImplementation(async function _Decide()
		{
			const decision = callIndex === deniedIndex ? { outcome: AuthorizationDecisionOutcomes.Deny, evidence: null } : _Allowed();
			callIndex += 1;
			return decision;
		});
		const repository = new PrismaRoutineFactsRepository(transaction, authorization as unknown as AuthorizationAuthority);
		const current = _Current();

		await expect(repository.requireCurrentReader(_CALLER, current.routine, current.revision, _NOW)).rejects.toThrow("routine reader no longer has current destination access");
	});

	it.each([
		["manual", { actorKind: "user" as const, actorId: "principal-1" }],
		["automatic", { actorKind: "system" as const, actorId: "opencrane-server/routine-schedule/v1" }],
	])("preserves the %s actor on both admitted firing effects", async function _Actors(_label, actor)
	{
		const authorization = _Authorization();
		const repository = new PrismaRoutineFactsRepository({} as Prisma.TransactionClient, authorization as unknown as AuthorizationAuthority);

		await expect(repository.admitFiringActions(_Current().routine, actor, _NOW, { firingId: "firing-1" })).resolves.toBe(true);
		expect(authorization.admitPrincipalBatch).toHaveBeenCalledWith([
			expect.objectContaining({ actorKind: actor.actorKind, actorId: actor.actorId, principalId: "principal-1", resource: { kind: ProductAuthorizationResourceKinds.Routine, id: "routine-1" }, action: ProductAuthorizationActions.Use }),
			expect.objectContaining({ actorKind: actor.actorKind, actorId: actor.actorId, principalId: "principal-1", resource: { kind: ProductAuthorizationResourceKinds.AgentService, id: "service-1" }, action: ProductAuthorizationActions.Invoke }),
		]);
	});
});
