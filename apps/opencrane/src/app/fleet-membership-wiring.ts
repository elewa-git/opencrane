import { readFileSync } from "node:fs";

import { PrismaManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import type { ManagedExecutionEvidenceAuthority } from "@opencrane/backend/server/agents/agent-services";
import { Ed25519FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { FleetMembershipSignatureVerifier } from "@opencrane/backend/server/iam/membership";
import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/** Longest configurable period for reusing one last signed membership revision. */
const _MAXIMUM_STALENESS_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Composes managed-service execution evidence from an exact mounted fleet verification key.
 *
 * The public key is deliberately file-only so Helm can rotate a projected Secret without placing
 * PEM material in the Pod environment. Missing or malformed trust configuration fails startup.
 *
 * @param environment - Process environment, injectable for focused configuration tests.
 * @returns The transaction-backed managed-service evidence authority.
 */
export function _CreateManagedExecutionEvidenceAuthority(environment: NodeJS.ProcessEnv = process.env): ManagedExecutionEvidenceAuthority
{
	const trustedIssuerId = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID");
	const issuerKeyId = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_KEY_ID");
	const publicKeyPath = _Required(environment, "OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE");
	if (!publicKeyPath.startsWith("/")) throw new Error("OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE must identify an absolute mounted key path");
	const maximumStalenessMs = _PositiveInteger(environment, "OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS", _MAXIMUM_STALENESS_MILLISECONDS);
	return new PrismaManagedExecutionEvidenceAuthority({
		trustedIssuerId,
		maximumStalenessMs,
		verifier: _CreateMountedFleetMembershipSignatureVerifier(publicKeyPath, issuerKeyId),
	});
}

/**
 * Creates a verifier that reloads the projected public-key file for every membership decision.
 *
 * Kubernetes updates projected Secret volumes atomically without restarting the Pod. Reloading at
 * this boundary makes an in-place key rotation effective on the next admission and prevents an old
 * immutable `KeyObject` from extending revoked trust until a manual rollout.
 *
 * @param publicKeyPath - Absolute projected Secret path containing one SPKI Ed25519 public key.
 * @param issuerKeyId - Exact signed key identifier bound to that mounted key.
 * @returns A verifier that fails closed when the current projection is missing or malformed.
 */
export function _CreateMountedFleetMembershipSignatureVerifier(publicKeyPath: string, issuerKeyId: string): FleetMembershipSignatureVerifier
{
	function _Load(): Ed25519FleetMembershipSignatureVerifier
	{
		const publicKey = readFileSync(publicKeyPath, "utf8");
		return new Ed25519FleetMembershipSignatureVerifier({ [issuerKeyId]: publicKey });
	}
	_Load();
	return {
		async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>
		{
			return _Load().verify(revision);
		},
	};
}

/** Reads one mandatory, non-empty trust coordinate. */
function _Required(environment: NodeJS.ProcessEnv, name: string): string
{
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} must be configured`);
	return value;
}

/** Reads one positive safe integer bounded against accidental long-lived membership trust. */
function _PositiveInteger(environment: NodeJS.ProcessEnv, name: string, maximum: number): number
{
	const value = Number(_Required(environment, name));
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
	return value;
}
