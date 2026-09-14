import { randomUUID } from "node:crypto";

import { AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, AuthorizationEffect, AuthorizationSubjectKind, MemoryDatasetState, OrgMemberStatus, OrgRole, PrincipalProvenance, type PrismaClient } from "@prisma/client";

import { PersonalMemoryOperationEvents, PersonalMemoryOperationKinds, PrismaPersonalMemoryOperationRepository, PrismaPersonalMemoryOperationUnitOfWork, type AdmitPersonalMemoryOperationCommand } from "@opencrane/backend/agents/personal/memory";
import { __ProductAuthorizationCapability, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

/** Seeds synthetic identity, a reviewed existing capability and one already-admitted Remember operation. */
export async function _CatalogFixture(prisma: PrismaClient)
{
	const principalId = randomUUID();
	const datasetId = randomUUID();
	const operationId = randomUUID();
	const documentId = randomUUID();
	const providerDatasetId = randomUUID();
	const indexingOperationId = randomUUID();
	const digest = `sha256:${"a".repeat(64)}`;
	const admittedAt = new Date();
	const recordedAt = new Date(admittedAt.getTime() + 1_000);
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.MemoryScope, ProductAuthorizationActions.Manage)!;
	await prisma.principal.create({ data: { id: principalId, siloId: principalId, issuer: "https://identity.example.test", subject: principalId, provenance: PrincipalProvenance.External } });
	await prisma.orgMembership.create({ data: { clusterTenant: principalId, subject: principalId, role: OrgRole.Member, status: OrgMemberStatus.Active } });
	await prisma.memoryDataset.create({ data: { id: datasetId, siloId: principalId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, createdBy: principalId, state: MemoryDatasetState.Provisioning, cogneeDatasetId: null } });
	const grant = await prisma.authorizationGrant.create({ data: {
		siloId: principalId, subjectKind: AuthorizationSubjectKind.Principal, subjectPrincipalId: principalId,
		boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, boundaryCoverage: AuthorizationBoundaryCoverage.Exact,
		catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest,
		capabilityId: capability.capabilityId, resourceKind: ProductAuthorizationResourceKinds.MemoryScope, resourceId: datasetId,
		effect: AuthorizationEffect.Allow, priority: 0, validFrom: admittedAt, createdBy: principalId,
	} });
	const command: AdmitPersonalMemoryOperationCommand = {
		operationId, siloId: principalId, datasetId, actorPrincipalId: principalId,
		idempotencyKeyDigest: `sha256:${operationId.replaceAll("-", "").repeat(2)}`, commandDigest: digest,
		kind: PersonalMemoryOperationKinds.Remember,
		source: { conversationId: randomUUID(), messageId: randomUUID(), messagePosition: 1n, payloadRef: randomUUID(), ciphertextDigest: digest, authorPrincipalId: principalId },
		contentDigest: digest, targetFactId: null, targetDocumentId: null, expectedFactRevision: null, providerDatasetId: null,
		task: { taskName: "personal-memory-operation", taskKey: operationId }, admittedAt,
	};
	await prisma.$transaction(async function _Admit(transaction)
	{
		await new PrismaPersonalMemoryOperationRepository(transaction).admit(command, async function _SyntheticReceipt(coordinates) { return { taskId: operationId, ...coordinates }; });
	}, { isolationLevel: "Serializable" });
	const operations = new PrismaPersonalMemoryOperationUnitOfWork(prisma);
	const event = { operationId, kind: command.kind };
	await operations.apply({ ...event, expectedRevision: 1, event: PersonalMemoryOperationEvents.DatasetEnsured, providerDatasetId }, recordedAt);
	await operations.apply({ ...event, expectedRevision: 2, event: PersonalMemoryOperationEvents.DocumentAdded, documentId, contentDigest: digest }, recordedAt);
	await operations.apply({ ...event, expectedRevision: 3, event: PersonalMemoryOperationEvents.IndexEvidenceSaved, indexingOperationId, expectedInputEvidenceDigest: digest }, recordedAt);
	await operations.apply({ ...event, expectedRevision: 4, event: PersonalMemoryOperationEvents.IndexingCompleted, indexingOperationId, expectedInputEvidenceDigest: digest, pipelineRunId: randomUUID() }, recordedAt);
	return { principalId, datasetId, operationId, documentId, grantId: grant.id, recordedAt, event: { ...event, expectedRevision: 5, event: PersonalMemoryOperationEvents.CatalogCommitted } as const };
}
