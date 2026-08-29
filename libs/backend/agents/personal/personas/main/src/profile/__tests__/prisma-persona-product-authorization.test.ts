import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PERSONA_CREATOR_GRANT_MANAGER_ID, PrismaPersonaProductAuthorizationRepository } from "../prisma-persona-product-authorization";

/** Builds the narrow central authority surface used by persona authorization tests. */
function _Authority(overrides: Partial<AuthorizationAuthority> = {}): AuthorizationAuthority
{
	return { listPrincipalEntitled: vi.fn().mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Persona, id: "profile-1" }]), admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow }), ...overrides } as unknown as AuthorizationAuthority;
}

describe("PrismaPersonaProductAuthorizationRepository", function _Suite()
{
	it("uses central Read and Edit for an exact owner-narrowed persona profile", async function _AuthorizesProfile()
	{
		const authority = _Authority();
		const repository = new PrismaPersonaProductAuthorizationRepository({} as Prisma.TransactionClient, authority, {} as ManagedAuthorizationGrantRepository);

		await expect(repository.canRead({ siloId: "silo-1", principalId: "principal-1" }, "profile-1")).resolves.toBe(true);
		await expect(repository.admitEdit({ siloId: "silo-1", principalId: "principal-1" }, "profile-1", { operation: "answer" })).resolves.toBe(true);
		expect(authority.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.Persona, id: "profile-1" }] }));
		expect(authority.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", resource: { kind: ProductAuthorizationResourceKinds.Persona, id: "profile-1" }, action: ProductAuthorizationActions.Edit }));
	});

	it("admits collection creation and seeds the complete creator grant set", async function _CreatesPersona()
	{
		const authority = _Authority();
		const managedGrants = { reconcileManagedResourceGrants: vi.fn().mockResolvedValue(6) } as unknown as ManagedAuthorizationGrantRepository;
		const repository = new PrismaPersonaProductAuthorizationRepository({} as Prisma.TransactionClient, authority, managedGrants);
		const caller = { siloId: "silo-1", principalId: "principal-1" } as const;

		await expect(repository.admitCollectionCreate(caller)).resolves.toBe(true);
		await repository.reconcileCreator(caller, "profile-1", new Date("2026-08-29T00:00:00.000Z"));
		expect(authority.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.PersonaCollection, id: "silo-1" }, action: ProductAuthorizationActions.Create }));
		const expectedGrants = ["discover", "read", "create", "edit", "use", "delete"].map(action => expect.objectContaining({ capability: expect.objectContaining({ capabilityId: `persona:${action}` }) }));
		expect(managedGrants.reconcileManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", managerId: PERSONA_CREATOR_GRANT_MANAGER_ID, resource: { kind: ProductAuthorizationResourceKinds.Persona, id: "profile-1" }, grants: expect.arrayContaining(expectedGrants) }));
	});
});
