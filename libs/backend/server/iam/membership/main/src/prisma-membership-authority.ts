import { Prisma, type PrismaClient } from "@prisma/client";

import type { FleetMembershipAssertion, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import type { JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { FleetMembershipAcceptance, FleetMembershipAcceptanceResult, FleetMembershipAuthorityRepository } from "./membership-authority.types";

/** Maps one verified assertion row to the signed target contract. */
function _assertion(row: { assertionId: string; siloId: string; subjectId: string }): FleetMembershipAssertion
{
	return { assertionId: row.assertionId, siloId: row.siloId, subjectId: row.subjectId };
}

/** Converts one stored revision row and its assertion rows into the signed-revision type. */
function _revision(row: { revision: number; issuerId: string; issuerKeyId: string; siloId: string; issuedAt: Date; expiresAt: Date; payloadDigest: string; signature: string; assertions: Array<{ assertionId: string; siloId: string; subjectId: string }> }): SignedFleetMembershipRevision
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
 * Reads stored membership revisions inside an existing database transaction.
 *
 * The accepted-revision row and its audit row commit together with the caller's work, so a run can
 * never exist while the membership it relied on was rolled back.
 *
 * Called by: libs/backend/agents/execution/inputs/main/src/personal-execution-identity-envelope-source.ts
 * and libs/backend/server/agents/agent-services/main/src/db/prisma-managed-execution-evidence.ts.
 * @implements FleetMembershipAuthorityRepository
 */
export class PrismaFleetMembershipAuthorityRepository implements FleetMembershipAuthorityRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: Prisma.TransactionClient;

	/**
	 * @param prisma - The transaction that owns the membership check and its surrounding work.
	 */
	constructor(prisma: Prisma.TransactionClient)
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
		// 1. Read the current high-watermark in the caller's transaction. The exact conditional write below
		// decides which concurrent acceptance owns the update without a handwritten advisory lock.
		const current = await this.prisma.highestAcceptedFleetMembership.findUnique({ where: { issuerId_siloId: { issuerId: acceptance.issuerId, siloId: acceptance.siloId } }, include: { verified: true } });
		if (current !== null && (current.revision > acceptance.revision || (current.revision === acceptance.revision && current.verified.payloadDigest !== acceptance.payloadDigest)))
		{
			return { status: "conflict", highestAcceptedRevision: current.revision } as const;
		}
		if (current?.revision === acceptance.revision)
			return { status: "already_accepted", highestAcceptedRevision: current.revision } as const;

		// 2. Only move the number when this exact revision and digest is really stored here.
		const revision = await this.prisma.verifiedFleetMembershipRevision.findFirst({ where: { issuerId: acceptance.issuerId, siloId: acceptance.siloId, revision: acceptance.revision, payloadDigest: acceptance.payloadDigest } });
		if (revision === null)
			return { status: "conflict", highestAcceptedRevision: current?.revision ?? 0 } as const;
		if (current === null)
		{
			await this.prisma.highestAcceptedFleetMembership.create({ data: { issuerId: acceptance.issuerId, siloId: acceptance.siloId, revisionId: revision.id, revision: acceptance.revision } });
		}
		else
		{
			const advanced = await this.prisma.highestAcceptedFleetMembership.updateMany({
				where: { issuerId: acceptance.issuerId, siloId: acceptance.siloId, revisionId: current.revisionId, revision: current.revision },
				data: { revisionId: revision.id, revision: acceptance.revision, acceptedAt: new Date() },
			});
			if (advanced.count !== 1)
			{
				const winner = await this.prisma.highestAcceptedFleetMembership.findUnique({ where: { issuerId_siloId: { issuerId: acceptance.issuerId, siloId: acceptance.siloId } }, include: { verified: true } });
				if (winner?.revision === acceptance.revision && winner.verified.payloadDigest === acceptance.payloadDigest)
					return { status: "already_accepted", highestAcceptedRevision: winner.revision } as const;
				return { status: "conflict", highestAcceptedRevision: winner?.revision ?? current.revision } as const;
			}
		}

		// 3. Write the audit row in the same transaction so the stored state and the audit log agree.
		const decisionDigest = __DigestCanonicalJson({ issuerId: acceptance.issuerId, siloId: acceptance.siloId, revision: acceptance.revision, payloadDigest: acceptance.payloadDigest } as JsonValue);
		await __AppendAuditDecision(this.prisma, {
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
}

/** Opens the serializable transaction used by standalone membership verification. */
export class PrismaFleetMembershipAuthorityUnitOfWork implements FleetMembershipAuthorityRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the standalone membership authority. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Loads the latest signed membership revision in a short serializable transaction. */
	async getLatestSignedRevision(trustedIssuerId: string, siloId: string): Promise<SignedFleetMembershipRevision | null>
	{
		return this._Run(async function _Load(repository)
		{
			return repository.getLatestSignedRevision(trustedIssuerId, siloId);
		});
	}

	/** Loads the accepted membership high-watermark in a short serializable transaction. */
	async getHighestAcceptedRevision(trustedIssuerId: string, siloId: string): Promise<number>
	{
		return this._Run(async function _Load(repository)
		{
			return repository.getHighestAcceptedRevision(trustedIssuerId, siloId);
		});
	}

	/** Advances the membership high-watermark and its audit row atomically. */
	async acceptRevisionAtomically(acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>
	{
		return this._Run(async function _Accept(repository)
		{
			return repository.acceptRevisionAtomically(acceptance);
		});
	}

	/** Runs one standalone membership operation in a serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaFleetMembershipAuthorityRepository) => Promise<TResult>): Promise<TResult>
	{
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaFleetMembershipAuthorityRepository(transaction);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
