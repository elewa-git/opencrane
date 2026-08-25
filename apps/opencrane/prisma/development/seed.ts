import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { ModelRoutingScope, OrgMemberStatus, OrgRole, PrincipalProvenance, PrismaClient } from "@prisma/client";

import { __DigestFleetMembershipSignedPayload } from "@opencrane/backend/server/iam/membership";
import { LOCAL_DEVELOPMENT_IDENTITY, LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER } from "@opencrane/models/local-development";
import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import type { LocalDevelopmentSeedDatabase, LocalDevelopmentSeedDependencies } from "./seed.types";

/** Prefix keeps every appended local membership revision identifiable without reusing a row id. */
const _REVISION_ID_PREFIX = "local-development-membership-revision";

/** Prefix keeps each immutable local assertion paired with its owning revision. */
const _ASSERTION_ROW_ID_PREFIX = "local-development-membership-assertion-row";

/** Stable model row selected by onboarding in core and every Agent alternative. */
const _MODEL_DEFINITION_ID = "local-development-model-auto";

/** Stable routing row points onboarding at the profile-independent public model alias. */
const _MODEL_ROUTING_DEFAULT_ID = "local-development-model-routing-default";

/** One week is long enough for a development session while the 24-hour staleness fence still applies. */
const _MEMBERSHIP_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

/** PostgreSQL and Prisma store membership revisions as signed 32-bit integers. */
const _MAXIMUM_MEMBERSHIP_REVISION = 2_147_483_647;

/** Builds the immutable database identifier for a local membership revision. */
function _MembershipRevisionId(revision: number): string
{
	return `${_REVISION_ID_PREFIX}-${revision}`;
}

/** Builds the immutable database identifier for an assertion revision. */
function _MembershipAssertionRowId(revision: number): string
{
	return `${_ASSERTION_ROW_ID_PREFIX}-${revision}`;
}

/** Read one required absolute key path supplied by the Tier 2 coordinator. */
function _ReadKeyPath(name: string): string
{
	const value = process.env[name]?.trim();

	if (!value?.startsWith("/"))
	{
		throw new Error(`${name} must be an absolute path`);
	}

	return value;
}

/** Refuse to seed a database that is not on this workstation's loopback interface. */
function _AssertLocalDatabase(): void
{
	const value = process.env.DATABASE_URL?.trim();

	if (!value)
	{
		throw new Error("DATABASE_URL is required for the Tier 2 seed");
	}

	const database = new URL(value);

	if (database.hostname !== "127.0.0.1" && database.hostname !== "localhost")
	{
		throw new Error("Tier 2 seed refuses a non-loopback PostgreSQL server");
	}
}

/** Builds and signs the personal-scope membership payload stored for local run admission. */
function _CreateSignedMembership(privateKeyPem: string, issuedAtEpochMs: number, revision: number): SignedFleetMembershipRevision
{
	const payload: Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature"> = {
		revision,
		issuerId: LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID,
		issuerKeyId: LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID,
		siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
		issuedAtEpochMs,
		expiresAtEpochMs: issuedAtEpochMs + _MEMBERSHIP_LIFETIME_MILLISECONDS,
		assertions: [{
			assertionId: LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID,
			siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
			subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId
		}],
	};
	const payloadDigest = __DigestFleetMembershipSignedPayload(payload);
	const signature = sign(null, Buffer.from(payloadDigest, "utf8"), createPrivateKey(privateKeyPem)).toString("base64url");
	return {
		...payload,
		payloadDigest,
		signature,
	};
}

/** Prove the coordinator supplied a matching Ed25519 keypair before storing signed authority. */
function _ReadMembershipPrivateKey(): string
{
	const privateKeyPem = readFileSync(_ReadKeyPath("OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH"), "utf8");
	const publicKeyPem = readFileSync(_ReadKeyPath("OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH"), "utf8");
	const derivedPublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
		format: "pem",
		type: "spki",
	}).toString();

	if (derivedPublicKey.trim() !== publicKeyPem.trim())
	{
		throw new Error("Tier 2 membership public and private keys do not match");
	}

	return privateKeyPem;
}

/** Default seed dependencies validate loopback state and create signed local membership evidence. */
const _SEED_DEPENDENCIES: LocalDevelopmentSeedDependencies = {
	assertLocalDatabase: _AssertLocalDatabase,
	createMembership(revision: number): SignedFleetMembershipRevision
	{
		return _CreateSignedMembership(_ReadMembershipPrivateKey(), Date.now(), revision);
	},
	createPrisma(): LocalDevelopmentSeedDatabase
	{
		return new PrismaClient() as unknown as LocalDevelopmentSeedDatabase;
	}
};

/**
 * Reconciles the fixed local identity and default model route, then appends new signed membership
 * evidence in one transaction. Each Tier 2 session may use a new disposable signing key, so replay
 * retains prior evidence and allocates a strictly increasing revision instead of updating immutable
 * authority rows.
 *
 * Called by: the `db:seed-tier2` package script through the Tier 2 coordinator.
 * @param dependencies - Loopback guard, signed membership factory, and database operations.
 * @returns A promise that resolves after the transaction completes and the seed connection closes.
 * @throws When the database is not local, the revision limit is reached, membership evidence is
 * invalid, or the transaction fails.
 */
export async function _RunLocalDevelopmentSeed(dependencies: LocalDevelopmentSeedDependencies = _SEED_DEPENDENCIES): Promise<void>
{
	// 1. Refuse remote state before opening Prisma.
	dependencies.assertLocalDatabase();
	const prisma = dependencies.createPrisma();

	try
	{
		// 2. Reconcile mutable browser state and append a new signed revision in one transaction.
		await prisma.$transaction(async function _Seed(transaction): Promise<void>
		{
			await transaction.principal.upsert({
				where: {
					siloId_issuer_subject: {
						siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
						issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
						subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId
					}
				},
				create: {
					id: LOCAL_DEVELOPMENT_PRINCIPAL_ID,
					siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
					issuer: LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER,
					subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId,
					provenance: PrincipalProvenance.External,
					email: LOCAL_DEVELOPMENT_IDENTITY.email,
					displayName: LOCAL_DEVELOPMENT_IDENTITY.displayName
				},
				update: {
					provenance: PrincipalProvenance.External,
					email: LOCAL_DEVELOPMENT_IDENTITY.email,
					displayName: LOCAL_DEVELOPMENT_IDENTITY.displayName
				}
			});
			await transaction.orgMembership.upsert({
				where: {
					clusterTenant_subject: {
						clusterTenant: LOCAL_DEVELOPMENT_IDENTITY.siloId,
						subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId,
					},
				},
				create: {
					clusterTenant: LOCAL_DEVELOPMENT_IDENTITY.siloId,
					subject: LOCAL_DEVELOPMENT_IDENTITY.subjectId,
					email: LOCAL_DEVELOPMENT_IDENTITY.email,
					displayName: LOCAL_DEVELOPMENT_IDENTITY.displayName,
					role: OrgRole.Owner,
					status: OrgMemberStatus.Active,
				},
				update: {
					email: LOCAL_DEVELOPMENT_IDENTITY.email,
					displayName: LOCAL_DEVELOPMENT_IDENTITY.displayName,
					role: OrgRole.Owner,
					status: OrgMemberStatus.Active,
				},
			});

			const latestMembership = await transaction.verifiedFleetMembershipRevision.findFirst({
				where: {
					issuerId: LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID,
					siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId
				},
				orderBy: { revision: "desc" },
				select: { revision: true }
			});
			const nextRevision = (latestMembership?.revision ?? 0) + 1;

			if (nextRevision > _MAXIMUM_MEMBERSHIP_REVISION)
			{
				throw new Error("Tier 2 membership revision limit reached; rerun with --reset");
			}

			const membership = dependencies.createMembership(nextRevision);
			const revisionId = _MembershipRevisionId(membership.revision);

			await transaction.verifiedFleetMembershipRevision.create({
				data: {
					id: revisionId,
					revision: membership.revision,
					issuerId: membership.issuerId,
					issuerKeyId: membership.issuerKeyId,
					siloId: membership.siloId,
					issuedAt: new Date(membership.issuedAtEpochMs),
					expiresAt: new Date(membership.expiresAtEpochMs),
					payloadDigest: membership.payloadDigest,
					signature: membership.signature,
				}
			});
			await transaction.verifiedFleetMembershipAssertion.create({
				data: {
					id: _MembershipAssertionRowId(membership.revision),
					revisionId,
					assertionId: LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID,
					siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
					subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId
				}
			});
			await transaction.modelDefinition.upsert({
				where: { id: _MODEL_DEFINITION_ID },
				create: {
					id: _MODEL_DEFINITION_ID,
					scope: ModelRoutingScope.Global,
					clusterTenant: null,
					publicModelName: "auto",
					litellmModelId: "local-development-auto",
					upstreamModel: "opencrane/local-development",
					isDefault: true,
				},
				update: {
					publicModelName: "auto",
					upstreamModel: "opencrane/local-development",
					isDefault: true,
				},
			});
			await transaction.modelRoutingDefault.upsert({
				where: { id: _MODEL_ROUTING_DEFAULT_ID },
				create: {
					id: _MODEL_ROUTING_DEFAULT_ID,
					scope: ModelRoutingScope.Global,
					clusterTenant: null,
					defaultModel: "auto",
				},
				update: { defaultModel: "auto" },
			});
		});
	}
	finally
	{
		// 3. Release the seed connection before the watched server starts its own pool.
		await prisma.$disconnect();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	void _RunLocalDevelopmentSeed();
