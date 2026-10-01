import { createHmac } from "node:crypto";

import type { ConversationPrivatePayloadKeyringDocument } from "@opencrane/backend/server/conversations/history";
import type { ConversationComputerLeaseCoordinates } from "@opencrane/backend/server/conversations/computers";
import type { ConversationComputerReviewCredentialDeriver } from "./conversation-computer-review.types";

/** Separates review credentials from every other use of the mounted keyring. */
const _DOMAIN = "conversation-computer-review-credential";

/** Joins the credentials the server presents for one lease; hex digests never contain it. */
const _BEARER_SEPARATOR = ",";

/**
 * Derives the bearer secret that the server presents to a sandbox review gateway.
 *
 * The lease id is only a name: it is a truncated hash of public coordinates and it is stamped on the
 * SandboxClaim and the Pod as a label, so anyone who can list Pods can read it. This deriver keys an
 * HMAC-SHA256 over the silo, computer, generation and lease id with a server-only keyring key. The
 * result is stable for one lease, so retries need no storage, it changes with every new lease, and a
 * Pod cannot compute it because the key never leaves the server.
 *
 * A Pod receives one credential at start, derived with the key that was current at that moment.
 * Rotating `currentKeyId` while that lease is alive must not lock the server out of its own Pod, so
 * `bearer` derives one credential per key still in the keyring, current first, and the Pod accepts
 * the request when any of them equals the one it holds. A key is removed from the keyring only when
 * it is retired, so a live lease keeps working until its granting key is gone.
 *
 * Called by: `_ConversationComputerReviewAuthority` when it resolves a route for the review proxy,
 * `HttpConversationComputerCheckpointSandbox` when it captures or restores a checkpoint, and
 * `ConversationComputerTurnAuthority.reviewCredential` when a bound Pod asks for its gateway secret.
 *
 * @implements ConversationComputerReviewCredentialDeriver
 */
export class KeyedConversationComputerReviewCredentialDeriver implements ConversationComputerReviewCredentialDeriver
{
	/** Decoded 256-bit keys, current key first so `bearer` lists the newest credential first. */
	private readonly keys: readonly Buffer[];

	/** Requires 256-bit keys and a current key that is present; refuses to start otherwise. */
	public constructor(currentKeyId: string, keys: Readonly<Record<string, string>>)
	{
		const current = keys[currentKeyId];
		if (current === undefined)
			throw new Error("Conversation computer review credential requires the current keyring key");
		const decoded = [current, ...Object.entries(keys).filter(function _Others([id]) { return id !== currentKeyId; }).map(function _Encoded([, value]) { return value; })].map(function _Decode(value) { return Buffer.from(value, "base64url"); });
		if (decoded.some(function _WrongSize(key) { return key.length !== 32; }))
			throw new Error("Conversation computer review credential key must be 256 bits");
		this.keys = decoded;
	}

	/** Builds the deriver from every key of the Secret-mounted conversation keyring. */
	public static fromKeyring(document: ConversationPrivatePayloadKeyringDocument): KeyedConversationComputerReviewCredentialDeriver
	{
		return new KeyedConversationComputerReviewCredentialDeriver(document.currentKeyId, document.keys);
	}

	/** @inheritdoc */
	public derive(coordinates: ConversationComputerLeaseCoordinates): string
	{
		return this._Credential(this.keys[0]!, coordinates);
	}

	/** @inheritdoc */
	public bearer(coordinates: ConversationComputerLeaseCoordinates): string
	{
		const credentials: string[] = [];
		for (const key of this.keys)
			credentials.push(this._Credential(key, coordinates));
		return credentials.join(_BEARER_SEPARATOR);
	}

	/** Computes the lease-bound HMAC under one key after checking the coordinates are complete. */
	private _Credential(key: Buffer, coordinates: ConversationComputerLeaseCoordinates): string
	{
		if (!coordinates.siloId || !coordinates.computerId || !coordinates.lease.leaseId || !Number.isSafeInteger(coordinates.lease.leaseGeneration) || coordinates.lease.leaseGeneration < 1)
			throw new Error("Conversation computer review credential requires complete lease coordinates");
		return createHmac("sha256", key).update(JSON.stringify([_DOMAIN, coordinates.siloId, coordinates.computerId, String(coordinates.lease.leaseGeneration), coordinates.lease.leaseId])).digest("hex");
	}
}
