import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { _CreateMountedPublicKeySource } from "@opencrane/backend/server/infra/auth";

import { Ed25519FleetMembershipSignatureVerifier } from "./ed25519-fleet-membership-signature-verifier";
import { FleetMembershipDeploymentModes } from "./membership-authority.types";
import type { FleetMembershipEvidenceConfig, FleetMembershipSignatureVerifier } from "./membership-authority.types";

/** Longest period a server may reuse its newest signed fleet-membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Placeholder issuer id for standalone mode; it matches no real issuer, so lookups find nothing. */
const _STANDALONE_ISSUER_ID = "opencrane-standalone-unconfigured";

/** Complete local issuer coordinates read only from the server's protected deployment settings. */
interface StandaloneMembershipIssuer
{
	/** Stable issuer identity recorded on each standalone snapshot. */
	readonly issuerId: string;
	/** Identifier of the local Ed25519 signing key. */
	readonly issuerKeyId: string;
	/** Absolute path of the mounted private key from which verification derives the public key. */
	readonly privateKeyPath: string;
}

/**
 * Reads this deployment's membership trust settings out of the environment.
 *
 * `OPENCRANE_MEMBERSHIP_MODE` must say `fleet` or `standalone`; there is no default, because
 * guessing would decide whether unsigned membership is possible. In `fleet` mode the issuer id, key
 * id, and public-key file are all required, and the key file is re-read before every signature check
 * so rotating the mounted key takes effect without a restart. In `standalone` mode, a complete
 * dedicated local signing-key configuration derives its public verification key from the mounted
 * private key. Without that complete configuration the verifier refuses every revision rather than
 * treating a local OrgMembership row or browser session as admission evidence.
 *
 * Called by: apps/opencrane/src/index.ts, apps/opencrane/src/app/channel-target-composition.ts, and
 * libs/backend/server/agents/agent-services/main/src/managed-execution-evidence.factory.ts.
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
		return _CreateStandaloneEvidenceConfig(environment, maximumStalenessMs);
	const trustedIssuerId = _Required(environment, "OPENCRANE_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _Required(environment, "OPENCRANE_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _Required(environment, "OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE");
	const source = _CreateMountedPublicKeySource(publicKeyPath);
	return { trustedIssuerId, maximumStalenessMs, verifier: _CreateReloadingVerifier(source.read, issuerKeyId) };
}

/** Builds a local signed-membership verifier only when the complete standalone issuer is mounted. */
function _CreateStandaloneEvidenceConfig(environment: NodeJS.ProcessEnv, maximumStalenessMs: number): FleetMembershipEvidenceConfig
{
	const issuer = _ReadStandaloneIssuer(environment);
	if (issuer === null)
		return { trustedIssuerId: _STANDALONE_ISSUER_ID, maximumStalenessMs, verifier: _CreateStandaloneDenyVerifier() };
	const readPublicKey = function _ReadPublicKey(): string
	{
		const privateKey = readFileSync(issuer.privateKeyPath, "utf8");
		return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
	};
	return { trustedIssuerId: issuer.issuerId, maximumStalenessMs, verifier: _CreateReloadingVerifier(readPublicKey, issuer.issuerKeyId) };
}

/** Reads an all-or-nothing standalone issuer, retaining the deny-only verifier when every field is absent. */
function _ReadStandaloneIssuer(environment: NodeJS.ProcessEnv): StandaloneMembershipIssuer | null
{
	const values = [environment["OPENCRANE_MEMBERSHIP_ISSUER_ID"]?.trim() ?? "", environment["OPENCRANE_MEMBERSHIP_KEY_ID"]?.trim() ?? "", environment["OPENCRANE_MEMBERSHIP_PRIVATE_KEY_FILE"]?.trim() ?? ""];
	if (values.every(function _Empty(value) { return value.length === 0; }))
		return null;
	if (values.some(function _Empty(value) { return value.length === 0; }))
		throw new Error("standalone membership issuer requires OPENCRANE_MEMBERSHIP_ISSUER_ID, OPENCRANE_MEMBERSHIP_KEY_ID, and OPENCRANE_MEMBERSHIP_PRIVATE_KEY_FILE together");
	const [issuerId, issuerKeyId, privateKeyPath] = values;
	return { issuerId, issuerKeyId, privateKeyPath };
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
