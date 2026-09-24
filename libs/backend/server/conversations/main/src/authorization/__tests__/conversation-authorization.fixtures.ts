import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { vi } from "vitest";

/** Supplies persisted grant rows to the real Prisma authorization mapper and central authority. */
export function _ConversationAuthorizationFixture()
{
	const grants = [ProductAuthorizationActions.Read, ProductAuthorizationActions.Use].map(function _Grant(action)
	{
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Conversation, action)!;
		return { id: `grant-${action}`, siloId: "silo-1", subjectKind: "Principal", subjectPrincipalId: "principal-1", subjectGroupId: null, boundaryKind: "Personal", boundaryPrincipalId: "principal-1", boundaryGroupId: null, boundaryCoverage: "Exact", catalogId: capability.catalog.catalogId, catalogRevision: capability.catalog.revision, catalogDigest: capability.catalog.digest, capabilityId: capability.capabilityId, resourceKind: ProductAuthorizationResourceKinds.Conversation, resourceId: "conversation-1", effect: "Allow", priority: 0, validFrom: new Date(0), expiresAt: null, revokedAt: null };
	});
	return {
		principal: { findUnique: vi.fn().mockResolvedValue({ id: "principal-1", subject: "user-1", provenance: "External" }) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
		authorizationGrant: { findMany: vi.fn().mockResolvedValue(grants) },
		auditDecision: { create: vi.fn().mockResolvedValue({}) },
	};
}
