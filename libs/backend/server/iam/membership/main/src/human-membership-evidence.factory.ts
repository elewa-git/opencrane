import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/backend/server/infra/auth";

import type { HumanMembershipEvidenceConfig } from "./human-membership.types";

import { Ed25519FleetMembershipSignatureVerifier } from "./ed25519-fleet-membership-signature-verifier";
import { FleetMembershipDeploymentModes } from "./membership-authority.types";
import type { FleetMembershipSignatureVerifier } from "./membership-authority.types";

/** Longest period the deployment may trust human membership evidence. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Selects human membership authority from deployment settings, never from a request.
 * Fleet requires its mounted verification key. Standalone requires the local silo and trusted
 * OIDC issuer and reads active PostgreSQL membership; failed Fleet verification never falls back.
 * Called by: the OpenCrane conversation history and run-admission compositions at startup.
 * @throws Error when a required setting is missing or the trust lifetime exceeds 24 hours.
 */
export function _CreateHumanMembershipEvidenceConfig(environment: NodeJS.ProcessEnv = process.env): HumanMembershipEvidenceConfig
{
	const mode = _DeploymentMode(environment);
	const maximumStalenessMs = _PositiveInteger(environment, "OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS", _MAXIMUM_STALENESS_MILLISECONDS);
	if (mode === FleetMembershipDeploymentModes.Standalone)
	{
		return { mode, siloId: _Required(environment, "OPENCRANE_SILO_ID"), trustedOidcIssuer: _Required(environment, "OIDC_ISSUER_URL"), maximumStalenessMs };
	}
	const trustedIssuerId = _Required(environment, "OPENCRANE_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _Required(environment, "OPENCRANE_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _Required(environment, "OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE");
	const source = _CreateMountedPublicKeySource(publicKeyPath);
	return { mode, trustedIssuerId, maximumStalenessMs, verifier: _CreateReloadingVerifier(source.read, issuerKeyId) };
}

/** Reads the configured mode; a missing or unknown value throws instead of defaulting to fleet. */
function _DeploymentMode(environment: NodeJS.ProcessEnv): FleetMembershipDeploymentModes
{
	const value = environment["OPENCRANE_MEMBERSHIP_MODE"]?.trim();
	if (value === FleetMembershipDeploymentModes.Fleet)
		return FleetMembershipDeploymentModes.Fleet;
	if (value === FleetMembershipDeploymentModes.Standalone)
		return FleetMembershipDeploymentModes.Standalone;
	throw new Error("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
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

/** Reads one required environment variable and trims it. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value)
		throw new Error(`${name} must be configured`);
	return value;
}

/** Reads a bounded positive staleness duration without silently extending trust. */
function _PositiveInteger(environment: NodeJS.ProcessEnv, name: string, maximum: number): number
{
	const value = Number(_Required(environment, name));
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
		throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
	return value;
}
