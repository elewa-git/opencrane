import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { _CreateFleetMembershipEvidenceConfig } from "../fleet-membership-evidence.factory";
import { __DigestFleetMembershipSignedPayload } from "../fleet-membership-payload-digest";

/** Writes one temporary Ed25519 keypair used by the production verifier tests. */
function _KeyPaths(): { readonly privateKeyPath: string; readonly publicKeyPath: string }
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-membership-"));
	const pair = generateKeyPairSync("ed25519");
	const privateKeyPath = join(directory, "private-key.pem");
	const publicKeyPath = join(directory, "public-key.pem");
	writeFileSync(privateKeyPath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
	writeFileSync(publicKeyPath, pair.publicKey.export({ type: "spki", format: "pem" }));
	return { privateKeyPath, publicKeyPath };
}

describe("_CreateFleetMembershipEvidenceConfig", function _describeFleetMembershipEvidenceConfig()
{
	it("builds only from complete mounted-key trust configuration", function _buildsCompleteTrustConfiguration()
	{
		const keys = _KeyPaths();
		expect(_CreateFleetMembershipEvidenceConfig({
			OPENCRANE_MEMBERSHIP_MODE: "fleet",
			OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
			OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
			OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: keys.publicKeyPath,
			OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		})).toBeDefined();
	});

	it("uses a dedicated standalone signing key as its verification trust root", function _usesStandaloneSigningKey()
	{
		const keys = _KeyPaths();
		const config = _CreateFleetMembershipEvidenceConfig({
			OPENCRANE_MEMBERSHIP_MODE: "standalone",
			OPENCRANE_MEMBERSHIP_ISSUER_ID: "standalone-silo-1",
			OPENCRANE_MEMBERSHIP_KEY_ID: "local-key-1",
			OPENCRANE_MEMBERSHIP_PRIVATE_KEY_FILE: keys.privateKeyPath,
			OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		});
		const unsigned = { revision: 1, issuerId: "standalone-silo-1", issuerKeyId: "local-key-1", siloId: "silo-1", issuedAtEpochMs: 1_000, expiresAtEpochMs: 2_000, assertions: [{ assertionId: "subject-1", siloId: "silo-1", subjectId: "subject-1" }] };
		const payloadDigest = __DigestFleetMembershipSignedPayload(unsigned);
		const signature = sign(null, Buffer.from(payloadDigest, "utf8"), createPrivateKey(readFileSync(keys.privateKeyPath, "utf8"))).toString("base64url");
		expect(config).toMatchObject({ trustedIssuerId: "standalone-silo-1" });
		return expect(config.verifier.verify({ ...unsigned, payloadDigest, signature })).resolves.toMatchObject({ verified: true });
	});

	it("starts standalone without a Fleet key but keeps every presented revision unverified", async function _startsStandaloneFailClosed()
	{
		const config = _CreateFleetMembershipEvidenceConfig({
			OPENCRANE_MEMBERSHIP_MODE: "standalone",
			OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		});
		await expect(config.verifier.verify({
			revision: 1,
			issuerId: "attacker",
			issuerKeyId: "attacker-key",
			siloId: "silo-1",
			issuedAtEpochMs: 1,
			expiresAtEpochMs: 2,
			payloadDigest: "sha256:payload",
			signature: "signature",
			assertions: [],
		})).resolves.toMatchObject({ verified: false });
	});

	it("fails closed for absent trust or an unbounded staleness policy", function _failsClosedForInvalidTrust()
	{
		expect(function _MissingMode() { return _CreateFleetMembershipEvidenceConfig({}); }).toThrow("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
		expect(function _UnboundedStaleness()
		{
			const keys = _KeyPaths();
			return _CreateFleetMembershipEvidenceConfig({
				OPENCRANE_MEMBERSHIP_MODE: "fleet",
				OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
				OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
				OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: keys.publicKeyPath,
				OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: String(24 * 60 * 60 * 1_000 + 1),
			});
		}).toThrow("must be a positive integer");
	});
});
