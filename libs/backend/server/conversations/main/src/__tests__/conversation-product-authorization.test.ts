import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaConversationProductAuthorizationRepository } from "../db/conversation-product-authorization";

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

/** Caller whose current direct Group memberships are resolved only by the central authority. */
const _CALLER = { siloId: "silo-1", principalId: "principal-1", issuer: "https://issuer.test", subjectId: "user-1" } as const;

describe("conversation product authorization", function _Suite()
{
	beforeEach(function _Reset()
	{
		vi.clearAllMocks();
		_authorization.listPrincipalEntitled.mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }]);
		_authorization.admitPrincipal.mockResolvedValue({ outcome: "allow", evidence: { decisionDigest: "digest" } });
	});

	it("evaluates reads across the Principal's current personal and Group boundaries", async function _ReadsAcrossBoundaries()
	{
		const repository = new PrismaConversationProductAuthorizationRepository({} as never);

		await expect(repository.canAccess(_CALLER, "conversation-1", ProductAuthorizationActions.Read)).resolves.toBe(true);

		expect(_authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", resources: [{ kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }] }));
		expect(_authorization.listPrincipalEntitled.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
	});

	it("records mutations through the same Principal-wide authority", async function _AdmitsAcrossBoundaries()
	{
		const repository = new PrismaConversationProductAuthorizationRepository({} as never);

		await expect(repository.admit(_CALLER, { kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }, ProductAuthorizationActions.Use, { messageId: "message-1" })).resolves.toBe(true);

		expect(_authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }, action: ProductAuthorizationActions.Use }));
		expect(_authorization.admitPrincipal.mock.calls[0]?.[0]).not.toHaveProperty("boundary");
	});
});
