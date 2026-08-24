import type { Prisma } from "@prisma/client";

import type { PersonalExecutionIdentityAuthorityRepository, PersonalFleetMembershipAssertion } from "./personal-execution-identity-envelope-source.types";

/**
 * Reads personal membership assertions and active capability grants with Prisma.
 *
 * Takes a transaction client rather than a Prisma client, so it can never open a second transaction
 * of its own: every read here has to see the same rows as the membership check that runs beside it.
 *
 * Constructed per admission by {@link PersonalExecutionIdentityEnvelopeSource}.
 *
 * @implements PersonalExecutionIdentityAuthorityRepository
 */
export class PrismaPersonalExecutionIdentityAuthorityRepository implements PersonalExecutionIdentityAuthorityRepository
{
	/** The admission transaction the caller owns. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the repository. It never opens a transaction of its own outside the admission one. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Resolves the stable local Principal and fails closed when issuer-bound identities collide. */
	async resolvePrincipalId(siloId: string, issuer: string, subjectId: string): Promise<string | null>
	{
		const principal = await this.prisma.principal.findUnique({ where: { siloId_issuer_subject: { siloId, issuer, subject: subjectId } }, select: { id: true } });
		return principal?.id ?? null;
	}

	/** Loads the one current personal assertion available before signature verification. */
	async loadLatestPersonalAssertion(trustedIssuerId: string, siloId: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>
	{
		const revision = await this.prisma.verifiedFleetMembershipRevision.findFirst({
			where: { issuerId: trustedIssuerId, siloId },
			orderBy: { revision: "desc" },
			select: { assertions: { where: { siloId, subjectId }, orderBy: { assertionId: "asc" }, select: { assertionId: true } } },
		});
		return _OneAssertion(revision?.assertions ?? []);
	}

	/** Re-reads the one personal assertion from the exact signed revision just verified. */
	async loadVerifiedPersonalAssertion(issuerId: string, siloId: string, revision: number, payloadDigest: string, subjectId: string): Promise<PersonalFleetMembershipAssertion | null>
	{
		const membership = await this.prisma.verifiedFleetMembershipRevision.findFirst({
			where: { issuerId, siloId, revision, payloadDigest },
			select: { assertions: { where: { siloId, subjectId }, orderBy: { assertionId: "asc" }, select: { assertionId: true } } },
		});
		return _OneAssertion(membership?.assertions ?? []);
	}

}

/** Returns the assertion only when there is exactly one and its ids are non-blank; otherwise null. */
function _OneAssertion(assertions: readonly PersonalFleetMembershipAssertion[]): PersonalFleetMembershipAssertion | null
{
	if (assertions.length !== 1) return null;
	const assertion = assertions[0];
	if (assertion === undefined || assertion.assertionId.trim().length === 0) return null;
	return assertion;
}
