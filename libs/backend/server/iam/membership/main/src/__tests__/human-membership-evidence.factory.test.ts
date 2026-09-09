import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { _CreateHumanMembershipEvidenceConfig } from "../human-membership-evidence.factory";

/** Writes one temporary Ed25519 public key accepted by the production verifier. */
function _PublicKeyPath(): string
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-membership-"));
	const pair = generateKeyPairSync("ed25519");
	const path = join(directory, "public-key.pem");
	writeFileSync(path, pair.publicKey.export({ type: "spki", format: "pem" }));
	return path;
}

describe("_CreateHumanMembershipEvidenceConfig", function _describeFleetMembershipEvidenceConfig()
{
	it("builds only from complete mounted-key trust configuration", function _buildsCompleteTrustConfiguration()
	{
		expect(_CreateHumanMembershipEvidenceConfig({
			OPENCRANE_MEMBERSHIP_MODE: "fleet",
			OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
			OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
			OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
			OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		})).toBeDefined();
	});

	it("selects local membership with a deployment silo and trusted OIDC issuer", function _Standalone()
	{
		expect(_CreateHumanMembershipEvidenceConfig({ OPENCRANE_MEMBERSHIP_MODE: "standalone", OPENCRANE_SILO_ID: "silo-1", OIDC_ISSUER_URL: "https://issuer.example", OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000" })).toEqual({ mode: "standalone", siloId: "silo-1", trustedOidcIssuer: "https://issuer.example", maximumStalenessMs: 300000 });
		expect(function _MissingSilo() { return _CreateHumanMembershipEvidenceConfig({ OPENCRANE_MEMBERSHIP_MODE: "standalone", OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000" }); }).toThrow("OPENCRANE_SILO_ID");
		expect(function _MissingIssuer() { return _CreateHumanMembershipEvidenceConfig({ OPENCRANE_MEMBERSHIP_MODE: "standalone", OPENCRANE_SILO_ID: "silo-1", OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: "300000" }); }).toThrow("OIDC_ISSUER_URL");
	});

	it("fails closed for absent trust or an unbounded staleness policy", function _failsClosedForInvalidTrust()
	{
		expect(function _MissingMode() { return _CreateHumanMembershipEvidenceConfig({}); }).toThrow("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
		expect(function _UnboundedStaleness()
		{
			return _CreateHumanMembershipEvidenceConfig({
				OPENCRANE_MEMBERSHIP_MODE: "fleet",
				OPENCRANE_MEMBERSHIP_ISSUER_ID: "fleet-1",
				OPENCRANE_MEMBERSHIP_KEY_ID: "fleet-key-1",
				OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
				OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS: String(24 * 60 * 60 * 1_000 + 1),
			});
		}).toThrow("must be a positive integer");
	});
});
