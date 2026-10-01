import { describe, expect, it, vi } from "vitest";

import { AuthorizationBoundaryKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { PrismaElicitationProductAuthorizationRepository } from "../elicitation-product-authorization";

const _NOW = new Date("2026-09-22T10:00:00.000Z");

describe("tool approval read authorization", function _Suite()
{
	it("returns only elicitation ids linked to currently readable approvals in this silo", async function _FiltersApprovalGrants()
	{
		const transaction = {
			principal: { findMany: vi.fn().mockResolvedValue([{ id: "requester-principal" }]) },
			approvalRequest: { findMany: vi.fn().mockResolvedValue([{ id: "approval-a", elicitationRequestId: "request-a" }, { id: "approval-b", elicitationRequestId: "request-b" }]) },
		};
		const authorization = { listEntitled: vi.fn().mockResolvedValue([{ kind: ProductAuthorizationResourceKinds.ApprovalRequest, id: "approval-b" }]) };
		const repository = new PrismaElicitationProductAuthorizationRepository(transaction as never, authorization as never);

		await expect(repository.filterReadableApprovalElicitationIds("silo-1", "requester", ["request-a", "request-b", "request-a", "missing-link"], _NOW)).resolves.toEqual(new Set(["request-b"]));
		expect(transaction.approvalRequest.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", elicitationRequestId: { in: ["request-a", "request-b", "missing-link"] } }, select: { id: true, elicitationRequestId: true } });
		expect(authorization.listEntitled).toHaveBeenCalledWith({ siloId: "silo-1", principalId: "requester-principal", boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: "requester-principal" }, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.ApprovalRequest, id: "approval-a" }, { kind: ProductAuthorizationResourceKinds.ApprovalRequest, id: "approval-b" }], nowEpochMs: _NOW.getTime() });
	});

	it.each([{ principals: [] }, { principals: [{ id: "principal-a" }, { id: "principal-b" }] }])("fails closed when the subject does not resolve to one principal: $principals", async function _RejectsAmbiguousPrincipal({ principals })
	{
		const transaction = { principal: { findMany: vi.fn().mockResolvedValue(principals) }, approvalRequest: { findMany: vi.fn() } };
		const authorization = { listEntitled: vi.fn() };
		const repository = new PrismaElicitationProductAuthorizationRepository(transaction as never, authorization as never);

		await expect(repository.filterReadableApprovalElicitationIds("silo-1", "requester", ["request-a"], _NOW)).resolves.toEqual(new Set());
		expect(transaction.approvalRequest.findMany).not.toHaveBeenCalled();
		expect(authorization.listEntitled).not.toHaveBeenCalled();
	});

	it("does not look up approval grants for an empty request batch", async function _SkipsEmptyBatch()
	{
		const transaction = { principal: { findMany: vi.fn() } };
		const authorization = { listEntitled: vi.fn() };
		const repository = new PrismaElicitationProductAuthorizationRepository(transaction as never, authorization as never);

		await expect(repository.filterReadableApprovalElicitationIds("silo-1", "requester", [], _NOW)).resolves.toEqual(new Set());
		expect(transaction.principal.findMany).not.toHaveBeenCalled();
	});
});
