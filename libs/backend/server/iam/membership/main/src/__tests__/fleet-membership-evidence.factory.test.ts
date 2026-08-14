import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { _CreateFleetMembershipEvidenceConfig } from "../fleet-membership-evidence.factory";

/** Writes one temporary Ed25519 public key accepted by the production verifier. */
function _PublicKeyPath(): string
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-membership-"));
	const pair = generateKeyPairSync("ed25519");
	const path = join(directory, "public-key.pem");
	writeFileSync(path, pair.publicKey.export({ type: "spki", format: "pem" }));
	return path;
}

describe("_CreateFleetMembershipEvidenceConfig", function _describeFleetMembershipEvidenceConfig()
{
	it("builds only from complete mounted-key trust configuration", function _buildsCompleteTrustConfiguration()
	{
		expect(_CreateFleetMembershipEvidenceConfig({
			OPENCRANE_MEMBERSHIP_MODE: "fleet",
			OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
			OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
			OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
			OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		})).toBeDefined();
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
			return _CreateFleetMembershipEvidenceConfig({
				OPENCRANE_MEMBERSHIP_MODE: "fleet",
				OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
				OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
				OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
				OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: String(24 * 60 * 60 * 1_000 + 1),
			});
		}).toThrow("must be a positive integer");
	});
});
