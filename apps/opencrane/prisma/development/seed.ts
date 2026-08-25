import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

import { ModelRoutingScope, OrgMemberStatus, OrgRole, PrincipalProvenance, PrismaClient } from "@prisma/client";

import { __DigestFleetMembershipSignedPayload } from "@opencrane/backend/server/iam/membership";
import { LOCAL_DEVELOPMENT_IDENTITY, LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ID, LOCAL_DEVELOPMENT_PRINCIPAL_ISSUER } from "@opencrane/models/local-development";
import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/** Stable row identifier lets the development seed be safely replayed after a watched-server reload. */
const _REVISION_ID = "local-development-membership-revision";

/** Stable row identifier lets the single personal assertion be updated without creating duplicates. */
const _ASSERTION_ROW_ID = "local-development-membership-assertion-row";

/** Stable model row selected by onboarding in core and every Agent alternative. */
const _MODEL_DEFINITION_ID = "local-development-model-auto";

/** Stable routing row points onboarding at the profile-independent public model alias. */
const _MODEL_ROUTING_DEFAULT_ID = "local-development-model-routing-default";

/** One week is long enough for a development session while the 24-hour staleness fence still applies. */
const _MEMBERSHIP_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

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

/** Build and sign the exact personal-scope membership payload stored for local run admission. */
function _CreateSignedMembership(privateKeyPem: string, issuedAtEpochMs: number): SignedFleetMembershipRevision
{
	const payload: Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature"> = {
		revision: 1,
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

/** Upsert the fixed local member and its signed personal-scope admission evidence. */
async function _Main(): Promise<void>
{
	// 1. Refuse remote state and validate the disposable signing keypair before opening Prisma.
	_AssertLocalDatabase();
	const privateKey = _ReadMembershipPrivateKey();
	const membership = _CreateSignedMembership(privateKey, Date.now());
	const prisma = new PrismaClient();

	try
	{
		// 2. Store the browser membership and signed run-admission assertion in one transaction.
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
			await transaction.verifiedFleetMembershipRevision.upsert({
				where: {
					issuerId_siloId_revision: {
						issuerId: membership.issuerId,
						siloId: membership.siloId,
						revision: membership.revision,
					},
				},
				create: {
					id: _REVISION_ID,
					revision: membership.revision,
					issuerId: membership.issuerId,
					issuerKeyId: membership.issuerKeyId,
					siloId: membership.siloId,
					issuedAt: new Date(membership.issuedAtEpochMs),
					expiresAt: new Date(membership.expiresAtEpochMs),
					payloadDigest: membership.payloadDigest,
					signature: membership.signature,
				},
				update: {
					issuerKeyId: membership.issuerKeyId,
					issuedAt: new Date(membership.issuedAtEpochMs),
					expiresAt: new Date(membership.expiresAtEpochMs),
					payloadDigest: membership.payloadDigest,
					signature: membership.signature,
				},
			});
			await transaction.verifiedFleetMembershipAssertion.upsert({
				where: {
					revisionId_assertionId: {
						revisionId: _REVISION_ID,
						assertionId: LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID,
					},
				},
				create: {
					id: _ASSERTION_ROW_ID,
					revisionId: _REVISION_ID,
					assertionId: LOCAL_DEVELOPMENT_MEMBERSHIP_ASSERTION_ID,
					siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
					subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId
				},
				update: {
					siloId: LOCAL_DEVELOPMENT_IDENTITY.siloId,
					subjectId: LOCAL_DEVELOPMENT_IDENTITY.subjectId
				},
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

void _Main();
