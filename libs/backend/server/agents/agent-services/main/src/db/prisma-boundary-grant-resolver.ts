import type { Prisma } from "@prisma/client";

import { PrismaAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { __DecideAuthorization, AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import type { AuthorizationBoundary, AuthorizationGrant } from "@opencrane/models/authorization";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type RevisionBoundaryAttachment } from "@opencrane/models/agents";

import type { BoundaryGrantResolutionCommand, BoundaryGrantResolver, EffectiveBoundaryGrant } from "../boundary-attachment-authority.types";

/** Converts one revision attachment into the generic authorization boundary vocabulary. */
function _Boundary(attachment: RevisionBoundaryAttachment): AuthorizationBoundary
{
	if (attachment.boundaryKind === RevisionBoundaryKinds.Group)
		return { kind: AuthorizationBoundaryKinds.Group, groupId: attachment.boundaryId };
	return { kind: AuthorizationBoundaryKinds.Personal, principalId: attachment.boundaryId };
}

/** Produces the stable coordinate whose grants must be decided together. */
function _GrantCoordinate(grant: AuthorizationGrant): string
{
	return `${grant.capability.catalog.catalogId}\u0000${grant.capability.catalog.revision}\u0000${grant.capability.catalog.digest}\u0000${grant.capability.capabilityId}\u0000${grant.resource.kind}\u0000${grant.resource.id}`;
}

/** Returns whether a winning grant covers the requested attachment geometry. */
function _WinningGrantCoversAttachment(grant: AuthorizationGrant, attachment: RevisionBoundaryAttachment): boolean
{
	return attachment.boundaryCoverage !== RevisionBoundaryCoverages.Descendants
		|| grant.boundaryCoverage === AuthorizationBoundaryCoverages.Descendants;
}

/**
 * Resolves revision boundaries through the same generic grant policy used by product authorization.
 *
 * Candidate grants are grouped by capability and resource because priority and deny precedence are
 * meaningful only for one exact authorization request. A boundary is effective when at least one
 * coordinate resolves to allow at the trusted time. Stored group ancestry is supplied to the pure
 * decision function, so a descendants grant on an ancestor can cover a child attachment. A requested
 * descendants attachment additionally requires a winning descendants grant; an exact allow cannot
 * be widened into subtree access.
 *
 * Called by: injected as `boundaryGrantResolver` in `prisma-agent-services.router.ts`, and constructed
 * inline by `PrismaManagedExecutionEvidenceAuthority.load` in
 * `prisma-managed-execution-evidence.ts`.
 */
export class PrismaBoundaryGrantRepository implements BoundaryGrantResolver
{
	/** OpenCrane product-authority transaction. */
	private readonly prisma: Prisma.TransactionClient;

	/**
	 * Creates a resolver over the caller's open Postgres transaction.
	 * @param prisma - Transaction used for every principal, grant, and hierarchy read.
	 */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Resolves allow-only boundaries after generic deny, priority, validity, and hierarchy decisions. */
	async resolveEffectiveBoundaryGrants(command: BoundaryGrantResolutionCommand): Promise<readonly EffectiveBoundaryGrant[]>
	{
		// 1. Reject incomplete coordinates before querying, so a malformed command grants nothing.
		if (!command.siloId.trim() || !Number.isSafeInteger(command.nowEpochMs) || command.nowEpochMs < 0 || command.principalIds.length === 0)
			return [];

		// 2. Prove every requested principal belongs to this silo before expanding its group memberships.
		const requestedPrincipalIds = [...new Set(command.principalIds)];
		const principalRows = await this.prisma.principal.findMany({ where: { siloId: command.siloId, id: { in: requestedPrincipalIds } }, select: { id: true } });
		const principalIds = [...new Set(principalRows.map(principal => principal.id))];
		if (principalIds.length !== requestedPrincipalIds.length)
			return [];

		// 3. Load the verified principals' direct and group grants through the same transaction.
		const repository = new PrismaAuthorizationGrantRepository(this.prisma);
		const subjectSets = await Promise.all(principalIds.map(principalId => repository.resolvePrincipalSubjects(command.siloId, principalId)));
		const subjects = subjectSets.flat();
		if (subjects.length === 0)
			return [];
		const grants = await repository.listSubjectGrants(command.siloId, subjects);

		// 4. Keep capability and resource requests separate, so deny and priority rules cannot mix.
		const grantsByCoordinate = new Map<string, AuthorizationGrant[]>();
		for (const grant of grants)
		{
			const coordinate = _GrantCoordinate(grant);
			const coordinateGrants = grantsByCoordinate.get(coordinate) ?? [];
			coordinateGrants.push(grant);
			grantsByCoordinate.set(coordinate, coordinateGrants);
		}

		// 5. Check each attachment against its hierarchy and require an allow with enough coverage.
		const effective: EffectiveBoundaryGrant[] = [];
		for (const attachment of command.attachments)
		{
			const boundary = _Boundary(attachment);
			const context = await repository.resolveBoundaryContext(command.siloId, boundary);
			let allowed = false;
			for (const coordinateGrants of grantsByCoordinate.values())
			{
				const coordinate = coordinateGrants[0];
				if (coordinate === undefined)
					continue;
				const decision = __DecideAuthorization({ siloId: command.siloId, subjects, boundary, capability: coordinate.capability, resource: coordinate.resource, nowEpochMs: command.nowEpochMs }, coordinateGrants, context);
				if (decision.outcome !== AuthorizationDecisionOutcomes.Allow)
					continue;
				const winningIds = new Set(decision.grantIds);
				if (coordinateGrants.some(grant => winningIds.has(grant.grantId) && _WinningGrantCoversAttachment(grant, attachment)))
				{ allowed = true; break; }
			}
			if (allowed)
				effective.push({ boundaryKind: attachment.boundaryKind, boundaryId: attachment.boundaryId, boundaryCoverage: attachment.boundaryCoverage });
		}
		return effective;
	}
}
