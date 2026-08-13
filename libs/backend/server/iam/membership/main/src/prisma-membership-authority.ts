import { Prisma, type PrismaClient } from "@prisma/client";

import type { AuthorizationScope, FleetMembershipAssertion, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { FleetMembershipAcceptance, FleetMembershipAcceptanceResult, FleetMembershipAuthorityRepository } from "./membership-authority.types.js";

/** Maps one verified assertion row to an independent authorization scope. */
function _scope(kind: string, organizationId: string, resourceId: string | null): AuthorizationScope
{
	switch (kind)
	{
		case "Organization": return { kind: "organization", organizationId };
		case "Department": return { kind: "department", organizationId, departmentId: resourceId ?? "" };
		case "Team": return { kind: "team", organizationId, teamId: resourceId ?? "" };
		case "Project": return { kind: "project", organizationId, projectId: resourceId ?? "" };
		case "Personal": return { kind: "personal", organizationId, userId: resourceId ?? "" };
		case "DirectUser": return { kind: "direct-user", organizationId, userId: resourceId ?? "" };
		default: throw new Error(`unknown fleet membership scope: ${kind}`);
	}
}

/** Maps one verified assertion row to the signed target contract. */
function _assertion(row: { assertionId: string; siloId: string; subjectId: string; scopeKind: string; organizationId: string; scopeResourceId: string | null }): FleetMembershipAssertion
{
	return { assertionId: row.assertionId, siloId: row.siloId, subjectId: row.subjectId, scope: _scope(row.scopeKind, row.organizationId, row.scopeResourceId) };
}

/** Converts one stored revision row and its assertion rows into the signed-revision type. */
function _revision(row: { revision: number; issuerId: string; issuerKeyId: string; siloId: string; issuedAt: Date; expiresAt: Date; payloadDigest: string; signature: string; assertions: Array<{ assertionId: string; siloId: string; subjectId: string; scopeKind: string; organizationId: string; scopeResourceId: string | null }> }): SignedFleetMembershipRevision
{
	return {
		revision: row.revision,
		issuerId: row.issuerId,
		issuerKeyId: row.issuerKeyId,
		siloId: row.siloId,
		issuedAtEpochMs: row.issuedAt.getTime(),
		expiresAtEpochMs: row.expiresAt.getTime(),
		payloadDigest: row.payloadDigest,
		signature: row.signature,
		assertions: row.assertions.map(_assertion),
	};
}

/**
 * Reads stored membership revisions from Postgres and moves the newest-accepted-revision number.
 *
 * Hand it a full PrismaClient and it opens its own transaction to record an acceptance. Hand it a
 * transaction client instead and it works inside that transaction on purpose: the accepted-revision
 * row and its audit row then commit together with whatever run admission the caller is doing, so a
 * run can never exist while the membership it relied on was rolled back.
 *
 * Called by: libs/backend/agents/execution/inputs/main/src/personal-execution-identity-envelope-source.ts
 * and libs/backend/server/agents/agent-services/main/src/prisma-managed-execution-evidence.ts, which
 * both pass their admission transaction, and apps/opencrane/src/app/channel-target-composition.ts.
 * @implements FleetMembershipAuthorityRepository
 */
export class PrismaFleetMembershipAuthorityRepository implements FleetMembershipAuthorityRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient | Prisma.TransactionClient;

	/**
	 * @param prisma - A full client, and this adapter opens its own acceptance transaction; or an
	 *                 existing transaction client, and it joins that transaction instead.
	 */
	constructor(prisma: PrismaClient | Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Loads the newest verified signed revision for one exact issuer and silo. */
	async getLatestSignedRevision(trustedIssuerId: string, siloId: string): Promise<SignedFleetMembershipRevision | null>
	{
		const row = await this.prisma.verifiedFleetMembershipRevision.findFirst({ where: { issuerId: trustedIssuerId, siloId }, orderBy: { revision: "desc" }, include: { assertions: true } });
		return row === null ? null : _revision(row);
	}

	/** Reads the highest revision number ever accepted for this issuer and silo; 0 when none. */
	async getHighestAcceptedRevision(trustedIssuerId: string, siloId: string): Promise<number>
	{
		const row = await this.prisma.highestAcceptedFleetMembership.findUnique({ where: { issuerId_siloId: { issuerId: trustedIssuerId, siloId } } });
		return row?.revision ?? 0;
	}

	/**
	 * Records the verified revision as the newest accepted one, together with its audit row.
	 *
	 * @param acceptance - Issuer, silo, revision number, and digest of the revision just verified.
	 * @returns `accepted`; `already_accepted` when the same revision and digest is already recorded;
	 *          or `conflict` when a newer revision won or the digest disagrees.
	 */
	async acceptRevisionAtomically(acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>
	{
		if (_ownsTransaction(this.prisma))
		{
			return this.prisma.$transaction(async function _accept(transaction: Prisma.TransactionClient)
			{
				return _acceptRevision(transaction, acceptance);
			});
		}
		return _acceptRevision(this.prisma, acceptance);
	}
}

/** Returns true for a full client (it has `$transaction`), false for a transaction client. */
function _ownsTransaction(prisma: PrismaClient | Prisma.TransactionClient): prisma is PrismaClient
{
	return "$transaction" in prisma;
}

/** Advances the membership high-watermark and audit inside the caller's already selected transaction. */
async function _acceptRevision(transaction: Prisma.TransactionClient, acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>
{
	// 1. Serialize even the first acceptance for an issuer/silo pair, where no row exists to lock.
	const lockKey = `${acceptance.issuerId}\u0000${acceptance.siloId}`;
	await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
	const current = await transaction.highestAcceptedFleetMembership.findUnique({ where: { issuerId_siloId: { issuerId: acceptance.issuerId, siloId: acceptance.siloId } }, include: { verified: true } });
	if (current !== null && (current.revision > acceptance.revision || (current.revision === acceptance.revision && current.verified.payloadDigest !== acceptance.payloadDigest)))
	{
		return { status: "conflict", highestAcceptedRevision: current.revision } as const;
	}
	if (current?.revision === acceptance.revision) return { status: "already_accepted", highestAcceptedRevision: current.revision } as const;

	// 2. Only move the number when this exact revision and digest is really stored here.
	const revision = await transaction.verifiedFleetMembershipRevision.findFirst({ where: { issuerId: acceptance.issuerId, siloId: acceptance.siloId, revision: acceptance.revision, payloadDigest: acceptance.payloadDigest } });
	if (revision === null) return { status: "conflict", highestAcceptedRevision: current?.revision ?? 0 } as const;
	await transaction.highestAcceptedFleetMembership.upsert({
		where: { issuerId_siloId: { issuerId: acceptance.issuerId, siloId: acceptance.siloId } },
		create: { issuerId: acceptance.issuerId, siloId: acceptance.siloId, revisionId: revision.id, revision: acceptance.revision },
		update: { revisionId: revision.id, revision: acceptance.revision, acceptedAt: new Date() },
	});

	// 3. Write the audit row in the same transaction so the stored state and the audit log agree.
	const decisionDigest = __DigestCanonicalJson({ issuerId: acceptance.issuerId, siloId: acceptance.siloId, revision: acceptance.revision, payloadDigest: acceptance.payloadDigest } as JsonValue);
	await __AppendAuditDecision(transaction, {
		decisionDigest,
		siloId: acceptance.siloId,
		actorKind: "system",
		actorId: acceptance.issuerId,
		resourceKind: "fleet-membership",
		resourceId: `${acceptance.issuerId}:${acceptance.siloId}`,
		action: "accept-revision",
		catalogId: "fleet-membership",
		catalogRevision: acceptance.revision,
		catalogDigest: acceptance.payloadDigest,
		argumentsDigest: acceptance.payloadDigest,
		policyRevisionHash: acceptance.payloadDigest,
		effectiveAuthorizationDigest: acceptance.payloadDigest,
		membershipRevision: acceptance.revision,
		outcome: "allow",
		reasonCode: "verified_revision_accepted",
	});
	return { status: "accepted", highestAcceptedRevision: acceptance.revision } as const;
}
