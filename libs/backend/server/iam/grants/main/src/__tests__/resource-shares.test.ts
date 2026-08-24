import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
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
		findRecipient: vi.fn(async function _findRecipient(siloId, shareId, recipientPrincipalId)
		{
			const grantId = state.recipients.get(recipientPrincipalId);
			if (!grantId || state.share === null) return null;
			return { shareId, siloId, ownerPrincipalId: state.share.ownerPrincipalId, recipientPrincipalId, grantId };
		}),
		revokeRecipient: vi.fn(async function _revokeRecipient(_siloId, _shareId, recipientPrincipalId)
		{
			const removed = state.recipients.delete(recipientPrincipalId);
			if (state.share !== null) state.share = { ...state.share, recipientPrincipalIds: [...state.recipients.keys()].sort() };
			return removed;
		}),
		listVisible: vi.fn(async function _listVisible() { return state.share === null ? [] : [state.share]; }),
	};
}

/** Builds the one transaction surface needed by ResourceShareService. */
function _authority(): { service: ResourceShareService; state: _State; execute: ReturnType<typeof vi.fn> }
{
	const state: _State = { share: null, recipients: new Map(), grantRevoked: false };
	const transaction: ResourceShareTransaction = {
		authorizationShares: {
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
	it("revokes the explicit recipient and its linked grant in one unit of work", async function _revoke()
	{
		const { service, state, execute } = _authority();
		state.share = { id: "share-1", siloId: "silo-a", ownerPrincipalId: "owner", resourceKind: ResourceShareKinds.Dataset, resourceId: "dataset-1", recipientPrincipalIds: ["recipient"] };
		state.recipients.set("recipient", "grant-1");
		const response = await request(_app(service)).delete("/api/v1/resource-shares/share-1/recipients/recipient");
		expect(response.status).toBe(204);
		expect(state.recipients.has("recipient")).toBe(false);
		expect(state.grantRevoked).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
