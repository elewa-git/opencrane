import { randomUUID } from "node:crypto";

import { AuthorizationBoundaryCoverage, AuthorizationBoundaryKind, AuthorizationEffect, AuthorizationSubjectKind, MemoryConsentState, MemoryDatasetState, OrgMemberStatus, OrgRole, PrincipalProvenance, type PrismaClient } from "@prisma/client";

import { MemoryFactProvenanceSourceKinds } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";

import type { ConversationCaller } from "../../../authorization/conversation-caller.types";

/** Synthetic current time shared by grants and command admission. */
export const _COMMAND_NOW = new Date("2026-09-14T08:00:00.000Z");

/** Durable rows needed to admit a Forget command against an existing personal fact. */
export interface PersonalMemoryCommandSqlFixture
{
	/** Authenticated owner of the personal dataset. */
	readonly caller: ConversationCaller;
	/** Existing active personal dataset selected by the server. */
	readonly datasetId: string;
	/** Existing active fact selected by the public command. */
	readonly factId: string;
	/** Adopted provider document coordinate retained only in SQL. */
	readonly documentId: string;
	/** Grant identifiers keyed by their product action. */
	readonly grantIds: ReadonlyMap<ProductAuthorizationActions, string>;
}

/** Seeds an external principal, current membership, active adopted dataset, fact and exact grants. */
export async function _PersonalMemoryCommandSqlFixture(prisma: PrismaClient, actions: readonly ProductAuthorizationActions[] = [ProductAuthorizationActions.Forget, ProductAuthorizationActions.Read], siloId = `memory-command-sql-${randomUUID()}`): Promise<PersonalMemoryCommandSqlFixture>
{
	const principalId = randomUUID();
	const subjectId = randomUUID();
	const datasetId = randomUUID();
	const factId = randomUUID();
	const documentId = randomUUID();
	await prisma.principal.create({ data: { id: principalId, siloId, issuer: "https://memory-command-sql.example", subject: subjectId, provenance: PrincipalProvenance.External } });
	await prisma.orgMembership.create({ data: { clusterTenant: siloId, subject: subjectId, role: OrgRole.Member, status: OrgMemberStatus.Active } });
	await prisma.memoryDataset.create({ data: { id: datasetId, siloId, boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: principalId, createdBy: principalId, state: MemoryDatasetState.Active, cogneeDatasetId: randomUUID() } });
	await prisma.memoryFactCatalog.create({ data: { id: factId, datasetId, cogneeExternalId: documentId, contentDigest: `sha256:${"a".repeat(64)}`, consentState: MemoryConsentState.Explicit, sensitivity: "personal", provenance: { sourceKind: MemoryFactProvenanceSourceKinds.Message }, sourceMessageId: randomUUID(), recordedBy: principalId } });
	const grantIds = new Map<ProductAuthorizationActions, string>();
	for (const action of actions)
	{
		grantIds.set(action, await _GrantPersonalMemoryAction(prisma, { siloId, principalId, datasetId }, action));
	}
	return { caller: { siloId, principalId, subjectId, externalIssuer: "https://memory-command-sql.example" }, datasetId, factId, documentId, grantIds };
}

/** Adds one exact personal MemoryScope grant to an existing synthetic fixture. */
export async function _GrantPersonalMemoryAction(prisma: PrismaClient, owner: { readonly siloId: string; readonly principalId: string; readonly datasetId: string }, action: ProductAuthorizationActions): Promise<string>
{
	const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.MemoryScope, action);
	if (capability === null)
		throw new Error(`The SQL fixture requires the existing MemoryScope/${action} capability`);
	const grant = await prisma.authorizationGrant.create({ data: {
		siloId: owner.siloId, subjectKind: AuthorizationSubjectKind.Principal, subjectPrincipalId: owner.principalId,
		boundaryKind: AuthorizationBoundaryKind.Personal, boundaryPrincipalId: owner.principalId, boundaryCoverage: AuthorizationBoundaryCoverage.Exact,
		catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest,
		capabilityId: capability.capabilityId, resourceKind: ProductAuthorizationResourceKinds.MemoryScope, resourceId: owner.datasetId,
		effect: AuthorizationEffect.Allow, priority: 0, validFrom: new Date(_COMMAND_NOW.getTime() - 1_000), createdBy: owner.principalId,
	} });
	return grant.id;
}
