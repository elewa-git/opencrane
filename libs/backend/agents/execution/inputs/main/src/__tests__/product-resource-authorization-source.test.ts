import { AuditDecisionActorKind, type Prisma } from "@prisma/client";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { describe, expect, it, vi } from "vitest";

import { TransactionBoundProductResourceAuthorizationSource } from "../product-resource-authorization-source";

/** Runs the central grant evaluator and audit writer with separate human and company Principals. */
function _RecordedFixture(kind: ExecutionSubjectMembershipKinds)
{
	const principalId = kind === ExecutionSubjectMembershipKinds.Fleet ? "human-1" : "company-principal";
	const resources = [
		{ principalId: "human-1", resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: "conversation-1" },
		{ principalId, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, resourceId: "model-1" },
	];
	const grants = resources.map(function _Grant(resource)
	{
		const capability = __ProductAuthorizationCapability(resource.resourceKind, ProductAuthorizationActions.Use)!;
		return { id: `grant-${resource.resourceKind}`, siloId: "silo-1", subjectKind: "Principal", subjectPrincipalId: resource.principalId, subjectGroupId: null, boundaryKind: "Personal", boundaryPrincipalId: resource.principalId, boundaryGroupId: null, boundaryCoverage: "Exact", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind: resource.resourceKind, resourceId: resource.resourceId, effect: "Allow", priority: 0, validFrom: new Date(0), expiresAt: null, revokedAt: null };
	});
	const transaction = {
		principal: { findUnique: vi.fn(async function _Principal(query: { where: { id_siloId: { id: string } } }) { const id = query.where.id_siloId.id; return { id, subject: id, provenance: id === "human-1" ? "External" : "Internal" }; }) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
		auditDecision: { create: vi.fn(async function _Persist(_command: { data: Prisma.AuditDecisionUncheckedCreateInput }) { return {}; }) },
	};
	const authorization = new PrismaAuthorizationAuthority(transaction as never);
	const source = new TransactionBoundProductResourceAuthorizationSource();
	async function _Load()
	{
		return source.load({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1" } as never, { principalId, agentIdentityId: "identity-1", membership: { kind, revision: 7 }, requester: { requesterPrincipalId: "human-1", membership: { revision: 7 } }, runScope: { agentRevisionId: "revision-1" } } as never, { personaId: null, personaRevisionId: null }, { datasetId: null, memoryQueryPolicy: {} }, { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [], skillRevisionIds: [], artifactRevisionIds: [] }, { authorization, admittedAtEpochMs: 1_000 } as never);
	}
	return { principalId, grants, transaction, load: _Load };
}

describe("TransactionBoundProductResourceAuthorizationSource", function _Suite()
{
	it("admits exact Conversation Use for the requester inside the run transaction", async function _AdmitsConversation()
	{
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: "sha256:conversation" } });
		const admitPrincipalBatch = vi.fn().mockResolvedValue([{ outcome: AuthorizationDecisionOutcomes.Allow }]);
		const source = new TransactionBoundProductResourceAuthorizationSource();
		const result = await source.load({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1" } as never, { principalId: "company-principal", agentIdentityId: "identity-1", membership: { kind: "managed" }, requester: { requesterPrincipalId: "principal-1", membership: { revision: 7 } }, runScope: { agentRevisionId: "revision-1" } } as never, { personaId: null, personaRevisionId: null }, { datasetId: null, memoryQueryPolicy: {} }, { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [], skillRevisionIds: [], artifactRevisionIds: [] }, { authorization: { admitPrincipal, admitPrincipalBatch }, admittedAtEpochMs: 1_000 } as never);
		expect(result).toEqual({ outcome: "loaded", value: null });
		expect(admitPrincipalBatch).toHaveBeenCalledWith([expect.objectContaining({ principalId: "company-principal", actorKind: "agent-service", actorId: "company-principal", membershipRevision: undefined })]);
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

	it.each([ExecutionSubjectMembershipKinds.Fleet, ExecutionSubjectMembershipKinds.Managed])("persists %s resource evidence through the real central recorder without claiming a workload", async function _RecordsPrincipal(kind)
	{
		const f = _RecordedFixture(kind);
		await expect(f.load()).resolves.toEqual({ outcome: "loaded", value: null });
		const records = f.transaction.auditDecision.create.mock.calls.map(call => call[0].data);
		const actorKind = kind === ExecutionSubjectMembershipKinds.Fleet ? AuditDecisionActorKind.User : AuditDecisionActorKind.AgentService;
		const membershipRevision = kind === ExecutionSubjectMembershipKinds.Fleet ? 7 : undefined;
		expect(records).toEqual([
			expect.objectContaining({ actorKind: AuditDecisionActorKind.User, actorId: "human-1", resourceKind: ProductAuthorizationResourceKinds.Conversation, membershipRevision: 7 }),
			expect.objectContaining({ actorKind, actorId: f.principalId, resourceKind: ProductAuthorizationResourceKinds.ModelDefinition, membershipRevision, decidedAt: new Date(1_000) }),
		]);
		expect(records[1]).toMatchObject({ audience: undefined, namespace: undefined, serviceAccountName: undefined, workloadKind: undefined, workloadUid: undefined, podUid: undefined });
	});

	it.each([ExecutionSubjectMembershipKinds.Fleet, ExecutionSubjectMembershipKinds.Managed])("does not let %s execution borrow another Principal's model grant", async function _PreservesExecutionPrincipal(kind)
	{
		const f = _RecordedFixture(kind);
		const otherPrincipalId = kind === ExecutionSubjectMembershipKinds.Fleet ? "company-principal" : "human-1";
		f.transaction.authorizationGrant.findMany.mockResolvedValue(f.grants.map(grant => grant.resourceKind === ProductAuthorizationResourceKinds.ModelDefinition ? { ...grant, subjectPrincipalId: otherPrincipalId, boundaryPrincipalId: otherPrincipalId } : grant));
		await expect(f.load()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(f.transaction.auditDecision.create.mock.calls.map(call => call[0].data.resourceKind)).toEqual([ProductAuthorizationResourceKinds.Conversation]);
	});

	it.each([ExecutionSubjectMembershipKinds.Fleet, ExecutionSubjectMembershipKinds.Managed])("denies %s admission when the requesting human is no longer active", async function _PreservesRequester(kind)
	{
		const f = _RecordedFixture(kind);
		f.transaction.orgMembership.findFirst.mockResolvedValue(null);
		await expect(f.load()).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(f.transaction.auditDecision.create).not.toHaveBeenCalled();
	});
});
