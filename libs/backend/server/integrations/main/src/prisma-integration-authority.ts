import { IntegrationCustodyState, IntegrationState, type PrismaClient } from "@prisma/client";

import type { IntegrationAuthorityClock, IntegrationAuthorityRepository, ResolveIntegrationAssignmentCommand, ResolveIntegrationAssignmentResult } from "./integration-resolution.types.js";

/** Production clock for integration-custody expiry checks. */
export class __SystemIntegrationAuthorityClock implements IntegrationAuthorityClock
{
	/** Returns the current system instant used by the server authority. */
	now(): Date
	{
		return new Date();
	}
}

/** Prisma-backed, credential-free read authority for immutable integration assignments. */
export class PrismaIntegrationAuthorityRepository implements IntegrationAuthorityRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;
	/** Authority-owned clock that prevents callers from backdating custody expiry checks. */
	private readonly clock: IntegrationAuthorityClock;

	/** Creates the integration authority adapter over the product Postgres database. */
	constructor(prisma: PrismaClient, clock: IntegrationAuthorityClock)
	{
		this.prisma = prisma;
		this.clock = clock;
	}

	/** Resolves one currently usable integration assignment without exposing any credential material. */
	async resolveAssignment(command: ResolveIntegrationAssignmentCommand): Promise<ResolveIntegrationAssignmentResult>
	{
		// 1. Read the immutable composite assignment so a foreign silo cannot select its own custody reference.
		const assignment = await this.prisma.agentRevisionIntegrationAssignment.findUnique({
			where: { agentRevisionId_integrationId: { agentRevisionId: command.agentRevisionId, integrationId: command.integrationId } },
			include: { integration: true, custodyReference: true },
		});
		if (assignment === null || assignment.siloId !== command.siloId) return { outcome: "unavailable", reason: "not_found" };

		// 2. Require the catalogue entry and custody reference to remain active at the requested instant.
		if (assignment.integration.state !== IntegrationState.Active) return { outcome: "unavailable", reason: "inactive" };
		if (assignment.custodyReference.state === IntegrationCustodyState.Revoked || assignment.custodyReference.revokedAt !== null) return { outcome: "unavailable", reason: "revoked" };
		if (assignment.custodyReference.state === IntegrationCustodyState.Expired || assignment.custodyReference.expiresAt <= this.clock.now()) return { outcome: "unavailable", reason: "expired" };
		if (assignment.custodyReference.state !== IntegrationCustodyState.Ready) return { outcome: "unavailable", reason: "inactive" };

		// 3. Return only the opaque custody reference and explicit allow-list for the Obot PEP to redeem.
		return { outcome: "resolved", assignment: { integrationId: assignment.integrationId, obotCatalogEntryId: assignment.integration.obotCatalogEntryId, obotCustodyReference: assignment.custodyReference.obotCustodyReference, allowedTools: assignment.allowedTools } };
	}
}
