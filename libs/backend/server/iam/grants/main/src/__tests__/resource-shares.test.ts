import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opencrane/backend/server/iam/authorization", async function _authorization()
{
	const actual = await vi.importActual("@opencrane/backend/server/iam/authorization");
	return { ...actual, __ResolvePrincipalAuthorization: vi.fn().mockResolvedValue({ outcome: "allow", reason: "winning_allow", grantIds: ["owner-grant"] }) };
});

import { __ResolvePrincipalAuthorization } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { ResourceShareService } from "../resource-share-service";
import type { ResourceShareRepository } from "../resource-share-repository.types";
import type { ResourceShareTransaction, ResourceShareUnitOfWork } from "../resource-share-unit-of-work.types";
import { ResourceShareKinds, type ResourceShareRecord } from "../resource-share.types";
import { resourceSharesRouter } from "../routes/resource-shares";

/** Mutable authority state shared by the focused service adapters. */
interface _State
{
	/** Persisted share parent, when created. */
	share: ResourceShareRecord | null;
	/** Recipient-to-grant relation. */
	recipients: Map<string, string>;
	/** Whether the linked grant has been soft-revoked. */
	grantRevoked: boolean;
}

/** Builds an in-memory repository that preserves the ResourceShare invariants under test. */
function _resourceShares(state: _State): ResourceShareRepository
{
	return {
		principalExists: vi.fn(async function _principalExists(_siloId, principalId) { return ["owner", "recipient"].includes(principalId); }),
		findByResource: vi.fn(async function _findByResource() { return state.share; }),
		createOrFind: vi.fn(async function _createOrFind(input)
		{
			const share = state.share ?? { id: "share-1", ...input, recipientPrincipalIds: [] };
			state.share = share;
			return share;
		}),
		findRecipient: vi.fn(async function _findRecipient(siloId, shareId, recipientPrincipalId)
		{
			const grantId = state.recipients.get(recipientPrincipalId);
			if (!grantId || state.share === null) return null;
			return { shareId, siloId, ownerPrincipalId: state.share.ownerPrincipalId, recipientPrincipalId, grantId };
		}),
		createRecipient: vi.fn(async function _createRecipient(input)
		{
			if (state.recipients.has(input.recipientPrincipalId)) return false;
			state.recipients.set(input.recipientPrincipalId, input.grantId);
			if (state.share !== null) state.share = { ...state.share, recipientPrincipalIds: [...state.recipients.keys()].sort() };
			return true;
		}),
		revokeRecipient: vi.fn(async function _revokeRecipient(_siloId, _shareId, recipientPrincipalId)
		{
			const removed = state.recipients.delete(recipientPrincipalId);
			if (state.share !== null) state.share = { ...state.share, recipientPrincipalIds: [...state.recipients.keys()].sort() };
			return removed;
		}),
		findById: vi.fn(async function _findById() { return state.share; }),
		listVisible: vi.fn(async function _listVisible() { return state.share === null ? [] : [state.share]; }),
	};
}

/** Builds the one transaction surface needed by ResourceShareService. */
function _authority(): { service: ResourceShareService; state: _State; execute: ReturnType<typeof vi.fn> }
{
	const state: _State = { share: null, recipients: new Map(), grantRevoked: false };
	const transaction: ResourceShareTransaction = {
		authorization: {} as ResourceShareTransaction["authorization"],
		capabilityCatalog: {
			findCapability: vi.fn().mockResolvedValue({ catalog: { catalogId: "opencrane-resource-sharing", revision: 1, digest: "sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775" }, capabilityId: "resource:read" }),
		},
		authorizationShares: {
			ensureCatalogRevision: vi.fn(),
			createOrFindExactShare: vi.fn().mockResolvedValue({ share: { id: "grant-1" }, created: true }),
			listActiveShares: vi.fn(),
			revokeOwnedShare: vi.fn(),
			revokeManagedShare: vi.fn(async function _revokeManagedShare() { state.grantRevoked = true; return true; }),
		},
		resourceShares: _resourceShares(state),
	};
	const execute = vi.fn();
	const unitOfWork: ResourceShareUnitOfWork = {
		async execute<Result>(procedure: (transaction: ResourceShareTransaction) => Promise<Result>): Promise<Result>
		{
			execute();
			return procedure(transaction);
		},
	};
	return { service: new ResourceShareService(unitOfWork), state, execute };
}

/** Mounts the route with a fixed authenticated or unauthenticated caller adapter. */
function _app(service: ResourceShareService, authenticated = true): Express
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/resource-shares", resourceSharesRouter(service, async function _caller()
	{
		return authenticated ? { siloId: "silo-a", principalId: "owner" } : null;
	}));
	return app;
}

describe("resource sharing", function _suite()
{
	beforeEach(function _allow()
	{
		vi.mocked(__ResolvePrincipalAuthorization).mockReset().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow", grantIds: ["owner-grant"] });
	});

	it("rejects an unauthenticated caller before invoking authority", async function _unauthenticated()
	{
		const { service, execute } = _authority();
		const response = await request(_app(service, false)).post("/api/v1/resource-shares").send({ resourceType: "file", resourceId: "file-1", recipientPrincipalId: "recipient" });
		expect(response.status).toBe(401);
		expect(execute).not.toHaveBeenCalled();
	});

	it("creates an explicit recipient and exact grant through one unit of work", async function _create()
	{
		const { service, state, execute } = _authority();
		const response = await request(_app(service)).post("/api/v1/resource-shares").send({ resourceType: "file", resourceId: "file-1", recipientPrincipalId: "recipient" });
		expect(response.status).toBe(201);
		expect(response.body).toMatchObject({ id: "share-1", ownerPrincipalId: "owner", recipientPrincipalIds: ["recipient"] });
		expect(state.recipients.get("recipient")).toBe("grant-1");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("fails closed before any share write when the caller lacks the resource grant", async function _deny()
	{
		vi.mocked(__ResolvePrincipalAuthorization).mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [] });
		const { service, state } = _authority();
		const response = await request(_app(service)).post("/api/v1/resource-shares").send({ resourceType: "chat", resourceId: "chat-1", recipientPrincipalId: "recipient" });
		expect(response.status).toBe(403);
		expect(state.share).toBeNull();
	});

	it("revokes the explicit recipient and its linked grant in one unit of work", async function _revoke()
	{
		const { service, state, execute } = _authority();
		await request(_app(service)).post("/api/v1/resource-shares").send({ resourceType: ResourceShareKinds.Dataset, resourceId: "dataset-1", recipientPrincipalId: "recipient" });
		execute.mockClear();
		const response = await request(_app(service)).delete("/api/v1/resource-shares/share-1/recipients/recipient");
		expect(response.status).toBe(204);
		expect(state.recipients.has("recipient")).toBe(false);
		expect(state.grantRevoked).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
