import { createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

import type { FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import { __DigestFleetMembershipSignedPayload } from "./fleet-membership-payload-digest.js";
import type { FleetMembershipSignatureVerifier } from "./membership-authority.types.js";

/**
 * Verifies fleet membership payload digests with an exact Ed25519 issuer-key ring.
 *
 * Fleet signs the UTF-8 `sha256:<hex>` payload-digest string. That digest covers the canonical
 * complete membership payload before the revision enters the verified local projection.
 */
export class Ed25519FleetMembershipSignatureVerifier implements FleetMembershipSignatureVerifier
{
	/** Trusted Ed25519 public keys indexed by their signed issuer-key identifier. */
	private readonly keys: ReadonlyMap<string, KeyObject>;

	/**
	 * Creates a verifier from mounted PEM public keys.
	 *
	 * @param publicKeysById - Trusted key identifiers and their SPKI PEM public keys.
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

	/** Verifies the detached base64url signature over the canonical payload digest. */
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
