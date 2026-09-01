import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import { PrismaManagedAuthorizationGrantRepository } from "../prisma-managed-authorization-grant-repository";

/** Proves newly written grants share the command's trusted decision timestamp. */
describe("PrismaManagedAuthorizationGrantRepository", function _Suite()
{
	it("starts a new grant at the command time so it is usable in the same transaction", async function _UsesCommandTime(): Promise<void>
	{
		const created = vi.fn().mockResolvedValue({});
		const transaction = {
			authorizationGrant: {
				findMany: vi.fn().mockResolvedValue([]),
				updateMany: vi.fn().mockResolvedValue({ count: 0 }),
				create: created
			},
			auditEntry: { create: vi.fn().mockResolvedValue({}) }
		} as unknown as Prisma.TransactionClient;
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.AgentRevision, ProductAuthorizationActions.Publish);
		if (capability === null)
		{
			throw new Error("Agent revision publication capability is missing");
		}
		const now = new Date("2026-09-01T12:00:00.123Z");
		const repository = new PrismaManagedAuthorizationGrantRepository(transaction);

		await repository.reconcileManagedResourceGrants({
			siloId: "silo-1",
			managerId: "personal-agent-owner-access:principal-1",
			resource: {
				kind: ProductAuthorizationResourceKinds.AgentRevision,
				id: "revision-1"
			},
			grants: [{
				subject: {
					kind: AuthorizationSubjectKinds.Principal,
					principalId: "principal-1"
				},
				boundary: {
					kind: AuthorizationBoundaryKinds.Personal,
					principalId: "principal-1"
				},
				boundaryCoverage: AuthorizationBoundaryCoverages.Exact,
				capability,
				resource: {
					kind: ProductAuthorizationResourceKinds.AgentRevision,
					id: "revision-1"
				},
				priority: 0,
				createdByPrincipalId: "principal-1"
			}],
			now
		});

		expect(created).toHaveBeenCalledWith({
			data: expect.objectContaining({
				validFrom: now,
				createdAt: now
			})
		});
	});
});
