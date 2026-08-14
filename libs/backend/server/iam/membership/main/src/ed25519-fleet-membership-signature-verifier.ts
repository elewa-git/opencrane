import { createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import { __DigestFleetMembershipSignedPayload } from "./fleet-membership-payload-digest";
import type { FleetMembershipSignatureVerifier } from "./membership-authority.types";

/**
 * Checks Ed25519 signatures on stored membership revisions against a fixed set of issuer keys.
 *
 * The issuer signs the UTF-8 bytes of the `sha256:<hex>` digest string, and that digest covers the
 * whole membership payload. So this class recomputes the digest itself and refuses a revision whose
 * stored digest disagrees, before it even looks at the signature — a caller cannot get a signature
 * checked against bytes of its own choosing.
 *
 * Called by: _CreateFleetMembershipEvidenceConfig in this package builds one per key read; the
 * resulting verifier is used by __VerifyCurrentFleetMembershipEvidence.
 * @implements FleetMembershipSignatureVerifier
 * @throws Error from the constructor when a key is blank, not Ed25519, or absent entirely.
 */
export class Ed25519FleetMembershipSignatureVerifier implements FleetMembershipSignatureVerifier
{
	/** Trusted Ed25519 public keys indexed by their signed issuer-key identifier. */
	private readonly keys: ReadonlyMap<string, KeyObject>;

	/**
	 * Creates a verifier from PEM public keys read off disk.
	 *
	 * @param publicKeysById - Key identifiers, as they appear in a revision's `issuerKeyId`, mapped to
	 *                         their SPKI PEM public keys.
	 * @throws Error when an identifier or PEM value is blank, when a key is not Ed25519, or when the
	 *         map is empty — starting with no usable key is a configuration mistake, not a state to
	 *         run in.
	 */
	constructor(publicKeysById: Readonly<Record<string, string>>)
	{
		const keys = new Map<string, KeyObject>();
		for (const [keyId, pem] of Object.entries(publicKeysById))
		{
			if (keyId.trim().length === 0 || pem.trim().length === 0) throw new Error("fleet membership key identifiers and PEM values must be non-empty");
			const key = createPublicKey(pem);
			if (key.asymmetricKeyType !== "ed25519") throw new Error(`fleet membership key ${keyId} must be Ed25519`);
			keys.set(keyId, key);
		}
		if (keys.size === 0) throw new Error("at least one fleet membership verification key is required");
		this.keys = keys;
	}

	/**
	 * Recomputes the digest, then checks the base64url signature over it.
	 *
	 * @param revision - Stored revision with its claimed digest and signature.
	 * @returns Evidence echoing what was seen, with `verified` true only when the key id is known, the
	 *          stored digest matches the recomputed one, and the signature holds. An unknown key or a
	 *          malformed signature gives `verified: false` rather than an exception.
	 */
	async verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>
	{
		const key = this.keys.get(revision.issuerKeyId);
		const computedPayloadDigest = __DigestFleetMembershipSignedPayload(revision);
		let verified = false;
		if (key !== undefined && revision.payloadDigest === computedPayloadDigest)
		{
			try
			{
				verified = verify(null, Buffer.from(computedPayloadDigest, "utf8"), key, Buffer.from(revision.signature, "base64url"));
			}
			catch
			{
				verified = false;
			}
		}
		return {
			verified,
			issuerId: revision.issuerId,
			issuerKeyId: revision.issuerKeyId,
			revision: revision.revision,
			siloId: revision.siloId,
			payloadDigest: revision.payloadDigest,
			signature: revision.signature,
		};
	}
}
