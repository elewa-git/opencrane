import type { Prisma } from "@prisma/client";

import { PrismaAuthorizationAuthority, PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import type { ConversationAssetProductAuthorizationRepository, ConversationAssetProductCaller } from "./conversation-asset-product-authorization.types";

/** Isolates the minimal exact grants derived from durable artifact ownership. */
const ARTIFACT_OWNER_GRANT_MANAGER_ID = "artifact-owner-access";

/** Transaction-scoped central product authority and artifact-owner grant projector. */
export class PrismaConversationAssetProductAuthorizationRepository implements ConversationAssetProductAuthorizationRepository
{
	private readonly transaction: Prisma.TransactionClient;
	private readonly authority: PrismaAuthorizationAuthority;
	private readonly managedGrants: PrismaManagedAuthorizationGrantRepository;

	constructor(transaction: Prisma.TransactionClient) { this.transaction = transaction; this.authority = new PrismaAuthorizationAuthority(transaction); this.managedGrants = new PrismaManagedAuthorizationGrantRepository(transaction); }

	/** Decides a read without introducing another owner or participant policy kernel. */
	async canAccess(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions): Promise<boolean>
	{
		const entitled = await this.authority.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, resources: [resource], action, nowEpochMs: Date.now() });
		return entitled.length === 1;
	}

	/** Records a protected asset or conversation mutation inside its owning transaction. */
	async admit(caller: ConversationAssetProductCaller, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>
	{
		return this.admitAs(caller, "user", caller.principalId, resource, action, argumentsValue);
	}

	/** Records a workload effect against the exact represented owner's personal boundary. */
	async admitAs(caller: ConversationAssetProductCaller, actorKind: "user" | "agent-service" | "workload" | "system", actorId: string, resource: ProductAuthorizationResourceLocator, action: ProductAuthorizationActions, argumentsValue: JsonValue): Promise<boolean>
	{
		const result = await this.authority.admitPrincipal({ siloId: caller.siloId, principalId: caller.principalId, actorKind, actorId, resource, action, argumentsDigest: ___DigestCanonicalJson(argumentsValue), nowEpochMs: Date.now() });
		return result.outcome === AuthorizationDecisionOutcomes.Allow;
	}

	/** Creates the minimal exact owner grant set atomically with a newly reserved Artifact. */
	async reconcileArtifactOwner(siloId: string, artifactId: string, principalId: string, now: Date): Promise<void>
	{
		const resource = { kind: ProductAuthorizationResourceKinds.Artifact, id: artifactId } as const;
		const actions = [ProductAuthorizationActions.Discover, ProductAuthorizationActions.Read, ProductAuthorizationActions.Create, ProductAuthorizationActions.Edit] as const;
		const grants = actions.map(action =>
		{
			const capability = __ProductAuthorizationCapability(resource.kind, action);
			if (capability === null)
				throw new Error(`artifact capability ${action} is unavailable`);
			return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId } as const;
		});
		await this.managedGrants.reconcileManagedResourceGrants({ siloId, managerId: ARTIFACT_OWNER_GRANT_MANAGER_ID, resource, grants, now });
	}
}
