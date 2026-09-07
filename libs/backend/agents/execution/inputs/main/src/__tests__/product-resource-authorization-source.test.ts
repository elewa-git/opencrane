import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { TransactionBoundProductResourceAuthorizationSource } from "../product-resource-authorization-source";

describe("TransactionBoundProductResourceAuthorizationSource", function _Suite()
{
	it("admits exact Conversation Use for the requester inside the run transaction", async function _AdmitsConversation()
	{
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:conversation" } });
		const admitPrincipalBatch = vi.fn().mockResolvedValue([{ outcome: AuthorizationDecisionOutcomes.Allow }]);
		const source = new TransactionBoundProductResourceAuthorizationSource();
		const result = await source.load({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1" } as never, { principalId: "company-principal", agentIdentityId: "identity-1", membership: { kind: "managed" }, requester: { requesterPrincipalId: "principal-1", membership: { revision: 7 } }, runScope: { agentRevisionId: "revision-1" } } as never, { personaId: null, personaRevisionId: null }, { datasetId: null, memoryQueryPolicy: {} }, { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [], skillRevisionIds: [], artifactRevisionIds: [] }, { authorization: { admitPrincipal, admitPrincipalBatch }, admittedAtEpochMs: 1_000 } as never);
		expect(result).toEqual({ outcome: "loaded", value: null });
		expect(admitPrincipalBatch).toHaveBeenCalledWith([expect.objectContaining({ principalId: "company-principal", actorKind: "workload", membershipRevision: undefined })]);
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ siloId: "silo-1", principalId: "principal-1", actorKind: "user", actorId: "principal-1", action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: "conversation-1" }, membershipRevision: 7, nowEpochMs: 1_000 }));
	});

	it("denies before resource admission when Conversation Use is refused", async function _DeniesConversation()
	{
		const admitPrincipalBatch = vi.fn();
		const source = new TransactionBoundProductResourceAuthorizationSource();
		const result = await source.load({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1" } as never, { principalId: "principal-1", agentIdentityId: "identity-1", membership: { kind: "fleet", revision: 7 }, requester: { requesterPrincipalId: "principal-1", membership: { revision: 7 } }, runScope: { agentRevisionId: "revision-1" } } as never, { personaId: null, personaRevisionId: null }, { datasetId: null, memoryQueryPolicy: {} }, { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [], skillRevisionIds: [], artifactRevisionIds: [] }, { authorization: { admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Deny, evidence: null }), admitPrincipalBatch }, admittedAtEpochMs: 1_000 } as never);
		expect(result).toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(admitPrincipalBatch).not.toHaveBeenCalled();
	});
});
