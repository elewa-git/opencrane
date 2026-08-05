import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { _CreateFleetMembershipEvidenceConfig } from "../fleet-membership-evidence.factory.js";

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
			OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID: "fleet-1",
			OPENCRANE_FLEET_MEMBERSHIP_KEY_ID: "fleet-key-1",
			OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
			OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		})).toBeDefined();
	});

	it("fails closed for absent trust or an unbounded staleness policy", function _failsClosedForInvalidTrust()
	{
		expect(function _MissingIssuer() { return _CreateFleetMembershipEvidenceConfig({}); }).toThrow("OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID must be configured");
		expect(function _UnboundedStaleness()
		{
			return _CreateFleetMembershipEvidenceConfig({
				OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID: "fleet-1",
				OPENCRANE_FLEET_MEMBERSHIP_KEY_ID: "fleet-key-1",
				OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
				OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS: String(24 * 60 * 60 * 1_000 + 1),
			});
		}).toThrow("must be a positive integer");
	});
});
