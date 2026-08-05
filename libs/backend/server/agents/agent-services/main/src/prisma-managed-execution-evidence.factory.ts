import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/backend/_server/auth";
import type { MountedPublicKeySource } from "@opencrane/backend/_server/auth";
import { Ed25519FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";

import { PrismaManagedExecutionEvidenceAuthority } from "./prisma-managed-execution-evidence.js";
import type { ManagedExecutionEvidenceAuthority } from "./managed-execution-evidence.types.js";

/** Longest configurable period for reusing one last signed membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Composes managed-service execution evidence from exact mounted fleet trust.
 * @param environment - Process environment, injectable for configuration tests.
 * @returns The transaction-backed managed-service evidence authority.
 */
export function _CreateManagedExecutionEvidenceAuthority(environment: NodeJS.ProcessEnv = process.env): ManagedExecutionEvidenceAuthority
{
	const trustedIssuerId = _required(environment, "OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _required(environment, "OPENCRANE_FLEET_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _required(environment, "OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE");
	const maximumStalenessMs = _positiveInteger(environment, "OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS", _MAXIMUM_STALENESS_MILLISECONDS);
	const source = _CreateMountedPublicKeySource(publicKeyPath);
	return new PrismaManagedExecutionEvidenceAuthority({
		trustedIssuerId,
		maximumStalenessMs,
		verifier: _createFleetMembershipSignatureVerifier(source, issuerKeyId),
	});
}

/** Creates a membership verifier that reloads the mounted public key for every decision. */
function _createFleetMembershipSignatureVerifier(source: MountedPublicKeySource, issuerKeyId: string): FleetMembershipSignatureVerifier
{
	/** Builds the verifier from the key currently projected into the process. */
	function _load(): Ed25519FleetMembershipSignatureVerifier
	{
		return new Ed25519FleetMembershipSignatureVerifier({ [issuerKeyId]: source.read() });
	}

	_load();
	return {
		async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>
		{
			return _load().verify(revision);
		},
	};
}

/** Reads one mandatory, non-empty trust coordinate. */
function _required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} must be configured`);
	return value;
}

/** Reads one positive safe integer bounded against accidental long-lived membership trust. */
function _positiveInteger(environment: NodeJS.ProcessEnv, name: string, maximum: number): number
{
	const value = Number(_required(environment, name));
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
	return value;
}
