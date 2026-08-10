import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/backend/server/infra/auth";

import { Ed25519FleetMembershipSignatureVerifier } from "./ed25519-fleet-membership-signature-verifier.js";
import { FleetMembershipDeploymentModes } from "./membership-authority.types.js";
import type { FleetMembershipEvidenceConfig, FleetMembershipSignatureVerifier } from "./membership-authority.types.js";

/** Longest period a server may reuse its newest signed fleet-membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Synthetic issuer identifier used only to keep absent standalone evidence denied. */
const _STANDALONE_ISSUER_ID = "opencrane-standalone-unconfigured";

/** Creates one reloadable mounted-key trust configuration without coupling it to an agent type. */
export function _CreateFleetMembershipEvidenceConfig(environment: NodeJS.ProcessEnv = process.env): FleetMembershipEvidenceConfig
{
	const mode = _DeploymentMode(environment);
	const maximumStalenessMs = _PositiveInteger(environment, "OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", _MAXIMUM_STALENESS_MILLISECONDS);
	if (mode === FleetMembershipDeploymentModes.Standalone)
	{
		return { trustedIssuerId: _STANDALONE_ISSUER_ID, maximumStalenessMs, verifier: _CreateStandaloneDenyVerifier() };
	}
	const trustedIssuerId = _Required(environment, "OPENCRANE_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _Required(environment, "OPENCRANE_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _Required(environment, "OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE");
	const source = _CreateMountedPublicKeySource(publicKeyPath);
	return { trustedIssuerId, maximumStalenessMs, verifier: _CreateReloadingVerifier(source.read, issuerKeyId) };
}

/** Reads the explicitly selected issuer model; absent configuration never implies Fleet trust. */
function _DeploymentMode(environment: NodeJS.ProcessEnv): FleetMembershipDeploymentModes
{
	const value = environment["OPENCRANE_MEMBERSHIP_MODE"]?.trim();
	if (value === FleetMembershipDeploymentModes.Fleet) return FleetMembershipDeploymentModes.Fleet;
	if (value === FleetMembershipDeploymentModes.Standalone) return FleetMembershipDeploymentModes.Standalone;
	throw new Error("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
}

/** Produces matching but unverified evidence so standalone startup can never convert missing trust into access. */
function _CreateStandaloneDenyVerifier(): FleetMembershipSignatureVerifier
{
	return {
		async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>
		{
			return {
				verified: false,
				issuerId: revision.issuerId,
				issuerKeyId: revision.issuerKeyId,
				revision: revision.revision,
				siloId: revision.siloId,
				payloadDigest: revision.payloadDigest,
				signature: revision.signature,
			};
		},
	};
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
