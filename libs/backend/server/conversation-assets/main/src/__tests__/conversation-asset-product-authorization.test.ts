import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaConversationAssetProductAuthorizationRepository } from "../conversation-asset-product-authorization";

const _authorization = vi.hoisted(function _AuthorizationSpies()
{
	return {
		admitPrincipal: vi.fn(),
		listPrincipalEntitled: vi.fn(),
	};
});

vi.mock("@opencrane/backend/server/iam/authorization", function _MockAuthorization()
{
	return {
		PrismaAuthorizationAuthority: class
		{
			async admitPrincipal(command: object) { return _authorization.admitPrincipal(command); }
			async listPrincipalEntitled(command: object) { return _authorization.listPrincipalEntitled(command); }
		},
		PrismaManagedAuthorizationGrantRepository: class {},
	};
});

/** Caller whose Group inheritance remains a central authorization concern. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1" } as const;

describe("conversation asset product authorization", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		_authorization.listPrincipalEntitled.mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Artifact, id: "artifact-1" }]);
		_authorization.admitPrincipal.mockResolvedValue({ outcome: "allow", evidence: { decisionDigest: "digest" } });
	});

	it("evaluates artifact reads across the Principal's current personal and Group boundaries", async function _ReadsAcrossBoundaries()
	{
		const repository = new PrismaConversationAssetProductAuthorizationRepository({} as never);

		await expect(repository.canAccess(_CALLER, { kind: ProductAuthorizationResourceKinds.Artifact, id: "artifact-1" }, ProductAuthorizationActions.Read)).resolves.toBe(true);

		expect(_authorization.listPrincipalEntitled.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
	});

	it("records artifact mutations through the same Principal-wide authority", async function _AdmitsAcrossBoundaries()
	{
		const repository = new PrismaConversationAssetProductAuthorizationRepository({} as never);

		await expect(repository.admit(_CALLER, { kind: ProductAuthorizationResourceKinds.Artifact, id: "artifact-1" }, ProductAuthorizationActions.Edit, { assetId: "asset-1" })).resolves.toBe(true);

		expect(_authorization.admitPrincipal.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
	});
});
