import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __DigestCanonicalJson, DeferredToolDecisionKinds, DeferredToolDecisionOutcomes } from "@opencrane/backend/server/iam/authorization";
import { ElicitationBodyKinds } from "@opencrane/contracts";

import { PrismaA2uiActionPurposeAuthority } from "../a2ui-action/prisma-a2ui-action-purpose";
import type { ElicitationPurposeRequest } from "../elicitation-purpose.types";
import { PrismaRuntimeInputPurposeAuthority } from "../runtime-input/prisma-runtime-input-purpose";
import { PrismaToolApprovalPurposeAuthority } from "../tool-approval/prisma-tool-approval-purpose";

/** Observe calls to IAM without replacing the purpose's database reads or input mapping. */
const _authorization = vi.hoisted(function _authorizationCalls()
{
	return { decide: vi.fn(), expire: vi.fn() };
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _authorizationModule(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/server/iam/authorization")>();
	return { ...original, __DecideDeferredToolRequest: _authorization.decide, __ExpireDeferredToolApprovalBatch: _authorization.expire };
});

/** Supply the saved request coordinates without constructing the full request lifecycle. */
function _request(): ElicitationPurposeRequest
{
	return {
		id: "request-1", runId: "run-1", attempt: 2, assignedParticipantId: "person-1",
		purposePayload: null, purposePayloadDigest: "unused", expiresAt: new Date("2026-09-09T01:00:00Z"),
	};
}

beforeEach(function _reset()
{
	_authorization.decide.mockReset().mockResolvedValue({ outcome: DeferredToolDecisionOutcomes.Approved });
	_authorization.expire.mockReset().mockResolvedValue(undefined);
});

describe("transaction-bound elicitation purposes", function _suite()
{
	it("writes ordinary answers and empty expiry deliveries through the supplied transaction", async function _runtimeDelivery()
	{
		const transaction = { elicitationResultDelivery: { create: vi.fn().mockResolvedValue({}) } };
		const owner = new PrismaRuntimeInputPurposeAuthority(transaction as unknown as Prisma.TransactionClient);
		const response = { kind: ElicitationBodyKinds.FreeText, text: "Use the first option" } as const;
		await expect(owner.apply(_request(), response)).resolves.toBe(true);
		await owner.expire(_request());
		expect(transaction.elicitationResultDelivery.create.mock.calls).toEqual([
			[{ data: { requestId: "request-1", payload: response, payloadDigest: __DigestCanonicalJson(response) } }],
			[{ data: { requestId: "request-1" } }],
		]);
	});

	it("checks the saved A2UI binding before writing a display-bound response", async function _a2uiDelivery()
	{
		const transaction = { elicitationResultDelivery: { create: vi.fn().mockResolvedValue({}) } };
		const owner = new PrismaA2uiActionPurposeAuthority(transaction as unknown as Prisma.TransactionClient);
		const purposePayload = { displayedActionId: "action-1", sourceComponentId: "card-1", actionDigest: "action-digest" };
		const request = { ..._request(), purposePayload, purposePayloadDigest: __DigestCanonicalJson(purposePayload) };
		const response = { kind: ElicitationBodyKinds.FreeText, text: "Confirmed" } as const;
		await expect(owner.apply({ ...request, purposePayload: { ...purposePayload, displayedActionId: "another-action" } }, response)).resolves.toBe(false);
		expect(transaction.elicitationResultDelivery.create).not.toHaveBeenCalled();
		await expect(owner.apply(request, response)).resolves.toBe(true);
		const payload = { kind: "a2ui_action", ...purposePayload, response };
		expect(transaction.elicitationResultDelivery.create).toHaveBeenCalledWith({ data: { requestId: request.id, payload, payloadDigest: __DigestCanonicalJson(payload) } });
	});

	it.each([true, false])("uses the saved reviewed arguments for approval=%s and keeps IAM on the same transaction", async function _toolDecision(approved)
	{
		const reviewedToolArguments = { query: "reviewed query" };
		const approval = { id: "approval-1", siloId: "silo-1", reviewedToolArguments };
		const transaction = { approvalRequest: { findUnique: vi.fn().mockResolvedValue(approval) } };
		const owner = new PrismaToolApprovalPurposeAuthority(transaction as unknown as Prisma.TransactionClient);
		const now = new Date("2026-09-09T00:00:00Z");
		await expect(owner.apply(_request(), { kind: ElicitationBodyKinds.Approval, approved }, "person-1", now)).resolves.toBe(true);
		expect(_authorization.decide).toHaveBeenCalledWith(transaction, {
			approvalRequestId: approval.id, siloId: approval.siloId, reviewerSubjectId: "person-1",
			decision: approved ? DeferredToolDecisionKinds.Approved : DeferredToolDecisionKinds.Denied,
			arguments: approved ? reviewedToolArguments : undefined,
			decidedBy: "person-1", now,
		});
		await owner.expire(_request(), now);
		expect(_authorization.expire).toHaveBeenCalledWith(transaction, { runId: "run-1", attempt: 2, now });
	});

	it("refuses a tool decision when the saved approval lacks reviewed arguments", async function _missingReview()
	{
		const transaction = { approvalRequest: { findUnique: vi.fn().mockResolvedValue({ reviewedToolArguments: null }) } };
		const owner = new PrismaToolApprovalPurposeAuthority(transaction as unknown as Prisma.TransactionClient);
		await expect(owner.apply(_request(), { kind: ElicitationBodyKinds.Approval, approved: true }, "person-1", new Date())).resolves.toBe(false);
		expect(_authorization.decide).not.toHaveBeenCalled();
	});
});
