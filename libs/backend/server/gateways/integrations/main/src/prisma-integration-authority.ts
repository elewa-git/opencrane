import { IntegrationCustodyState, IntegrationState, type PrismaClient } from "@prisma/client";

import { __AreReviewedIntegrationToolDefinitionsValid, type ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import type { IntegrationAuthorityClock, IntegrationAuthorityRepository, ResolveIntegrationAssignmentCommand, ResolveIntegrationAssignmentResult } from "./integration-resolution.types.js";

/**
 * The real system clock, used in production for custody expiry checks.
 *
 * Called by: constructed in apps/opencrane/src/app/external-action-composition.ts and handed to
 * {@link PrismaIntegrationAuthorityRepository}. Tests substitute their own
 * `IntegrationAuthorityClock` instead.
 */
export class __SystemIntegrationAuthorityClock implements IntegrationAuthorityClock
{
	/** Returns the current system instant used by the server authority. */
	now(): Date
	{
		return new Date();
	}
}

/**
 * Answers "may this revision use this integration right now?" out of Postgres, without ever
 * returning credential material.
 *
 * The checks run in a fixed order and all of them must pass: the assignment exists, it belongs to
 * the caller's silo, the integration row is Active, custody is not revoked, custody has not
 * expired against the injected clock, custody state is Ready, and the stored tool definitions
 * still validate. Any single failure returns `{ outcome: "unavailable" }` — the class never
 * partially succeeds.
 *
 * Called by: constructed in apps/opencrane/src/app/external-action-composition.ts and passed as
 * the `integrations` dependency to the external-action executor
 * (libs/backend/agents/execution/protocol/src/integration-external-action-executor.ts).
 *
 * @see {@link ResolveIntegrationAssignmentResult} for how a caller should react to each reason.
 */
export class PrismaIntegrationAuthorityRepository implements IntegrationAuthorityRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;
	/** Clock supplied by the server, not the caller, so nobody can pass a stale "now" and keep using expired custody. */
	private readonly clock: IntegrationAuthorityClock;

	/** Creates the integration authority adapter over the product Postgres database. */
	constructor(prisma: PrismaClient, clock: IntegrationAuthorityClock)
	{
		this.prisma = prisma;
		this.clock = clock;
	}

	/**
	 * Look up one integration assignment and return it only if every usability check passes.
	 *
	 * The silo check comes first and deliberately reports `not_found` rather than a distinct
	 * "wrong silo" reason, so a caller cannot probe for the existence of another customer's
	 * integrations. Tool definitions are returned as a deep copy, so a caller cannot mutate what is
	 * stored.
	 *
	 * @param command - Silo, revision, and integration to resolve.
	 * @returns `resolved` with the opaque custody handle and reviewed tool definitions, or
	 *          `unavailable` with `not_found` / `inactive` / `revoked` / `expired`.
	 * @throws Whatever the Prisma client throws when the database is unreachable; a usability
	 *         failure is a return value, not an exception.
	 * @see https://www.rfc-editor.org/rfc/rfc8785 — `___CloneCanonicalJson` copies the stored tool
	 *      definitions through RFC 8785 canonical JSON.
	 */
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
		const toolDefinitions = assignment.toolDefinitions as unknown as readonly ReviewedIntegrationToolDefinition[];
		if (!Array.isArray(toolDefinitions) || !__AreReviewedIntegrationToolDefinitionsValid(toolDefinitions)) return { outcome: "unavailable", reason: "inactive" };

		// 3. Return only the opaque custody reference and the reviewed definitions. Obot is the policy
		//    enforcement point (PEP): it holds the real secret and decides whether the call is allowed,
		//    so this side never needs the credential itself.
		return { outcome: "resolved", assignment: { integrationId: assignment.integrationId, obotCatalogEntryId: assignment.integration.obotCatalogEntryId, obotCustodyReference: assignment.custodyReference.obotCustodyReference, toolDefinitions: ___CloneCanonicalJson(assignment.toolDefinitions as unknown as JsonValue) as unknown as readonly ReviewedIntegrationToolDefinition[] } };
	}
}
