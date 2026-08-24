import { readFileSync } from "node:fs";

import { Ed25519FleetMembershipSignatureVerifier, type FleetMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID, LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID } from "@opencrane/models/local-development";

/** Maximum age of the disposable signed membership before a fresh coordinator seed is required. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Build membership trust from the coordinator-generated public key and fixed development issuer. */
export function _CreateDevelopmentMembershipEvidence(publicKeyPath: string): FleetMembershipEvidenceConfig
{
	const publicKey = readFileSync(publicKeyPath, "utf8");
	return {
		trustedIssuerId: LOCAL_DEVELOPMENT_MEMBERSHIP_ISSUER_ID,
		maximumStalenessMs: _MAXIMUM_STALENESS_MILLISECONDS,
		verifier: new Ed25519FleetMembershipSignatureVerifier({ [LOCAL_DEVELOPMENT_MEMBERSHIP_KEY_ID]: publicKey }),
	};
}
