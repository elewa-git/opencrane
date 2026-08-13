import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/backend/server/infra/auth";

import { Ed25519FleetMembershipSignatureVerifier } from "./ed25519-fleet-membership-signature-verifier.js";
import { FleetMembershipDeploymentModes } from "./membership-authority.types.js";
import type { FleetMembershipEvidenceConfig, FleetMembershipSignatureVerifier } from "./membership-authority.types.js";

/** Longest period a server may reuse its newest signed fleet-membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Placeholder issuer id for standalone mode; it matches no real issuer, so lookups find nothing. */
const _STANDALONE_ISSUER_ID = "opencrane-standalone-unconfigured";

/**
 * Reads this deployment's membership trust settings out of the environment.
 *
 * `OPENCRANE_MEMBERSHIP_MODE` must say `fleet` or `standalone`; there is no default, because
 * guessing would decide whether unsigned membership is possible. In `fleet` mode the issuer id, key
 * id, and public-key file are all required, and the key file is re-read before every signature check
 * so rotating the mounted key takes effect without a restart. In `standalone` mode there is no key,
 * so the verifier returned refuses every revision — the silo simply has no fleet membership yet
 * rather than an unchecked one.
 *
 * Called by: apps/opencrane/src/index.ts, apps/opencrane/src/app/channel-target-composition.ts, and
 * libs/backend/server/agents/agent-services/main/src/prisma-managed-execution-evidence.factory.ts.
 * @param environment - Process environment to read; defaults to `process.env`, overridden in tests.
 * @returns Trusted issuer, staleness limit in milliseconds, and the verifier to use.
 * @throws Error when the mode is missing or unrecognised, when a required `fleet` variable is
 *         absent, or when the staleness override is not a positive integer of at most 24 hours.
 */
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

/** Reads the configured mode; a missing or unknown value throws instead of defaulting to fleet. */
function _DeploymentMode(environment: NodeJS.ProcessEnv): FleetMembershipDeploymentModes
{
	const value = environment["OPENCRANE_MEMBERSHIP_MODE"]?.trim();
	if (value === FleetMembershipDeploymentModes.Fleet) return FleetMembershipDeploymentModes.Fleet;
	if (value === FleetMembershipDeploymentModes.Standalone) return FleetMembershipDeploymentModes.Standalone;
	throw new Error("OPENCRANE_MEMBERSHIP_MODE must be standalone or fleet");
}

/** Returns a verifier that always answers "not verified", so a silo with no key grants nothing. */
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

/** Reads one required environment variable and trims it. */
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
