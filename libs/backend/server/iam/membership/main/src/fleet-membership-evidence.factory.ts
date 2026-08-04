import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/server/_infra/auth";

import { Ed25519FleetMembershipSignatureVerifier } from "./ed25519-fleet-membership-signature-verifier.js";
import type { FleetMembershipEvidenceConfig, FleetMembershipSignatureVerifier } from "./membership-authority.types.js";

/** Longest period a server may reuse its newest signed fleet-membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Creates one reloadable mounted-key trust configuration without coupling it to an agent type. */
export function _CreateFleetMembershipEvidenceConfig(environment: NodeJS.ProcessEnv = process.env): FleetMembershipEvidenceConfig
{
	const trustedIssuerId = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE");
	const maximumStalenessMs = _PositiveInteger(environment, "OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS", _MAXIMUM_STALENESS_MILLISECONDS);
	const source = _CreateMountedPublicKeySource(publicKeyPath);
	return { trustedIssuerId, maximumStalenessMs, verifier: _CreateReloadingVerifier(source.read, issuerKeyId) };
}

/** Creates a verifier that reloads the projected key before every signed membership decision. */
function _CreateReloadingVerifier(read: () => string, issuerKeyId: string): FleetMembershipSignatureVerifier
{
	/** Reconstructs the Ed25519 key ring so an atomic projected-key rotation applies immediately. */
	function _Load(): Ed25519FleetMembershipSignatureVerifier
	{
		return new Ed25519FleetMembershipSignatureVerifier({ [issuerKeyId]: read() });
	}
	_Load();
	return { async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence> { return _Load().verify(revision); } };
}

/** Reads one mandatory process-owned trust coordinate. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} must be configured`);
	return value;
}

/** Reads a bounded positive staleness duration without silently extending trust. */
function _PositiveInteger(environment: NodeJS.ProcessEnv, name: string, maximum: number): number
{
	const value = Number(_Required(environment, name));
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
	return value;
}
