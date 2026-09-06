import { createHmac } from "node:crypto";

import type { ConversationPrivatePayloadKeyringDocument } from "../conversation-private-payload.types";
import type { ConversationComputerReviewCredentialCoordinates, ConversationComputerReviewCredentialDeriver } from "./conversation-computer-review.types";

/** Separates review credentials from every other use of the mounted keyring. */
const _DOMAIN = "conversation-computer-review-credential";

/**
 * Derives the bearer secret that the server presents to a sandbox review gateway.
 *
 * The lease id is only a name: it is a truncated hash of public coordinates and it is stamped on the
 * SandboxClaim and the Pod as a label, so anyone who can list Pods can read it. This deriver keys an
 * HMAC-SHA256 over the silo, computer, generation and lease id with the server-only keyring key. The
 * result is stable for one lease, so retries need no storage, it changes with every new lease, and a
 * Pod cannot compute it because the key never leaves the server.
 *
 * Called by: `_ConversationComputerReviewAuthority` when it resolves a route for the review proxy and
 * `ConversationComputerTurnAuthority.reviewCredential` when a bound Pod asks for its gateway secret.
 *
 * @implements ConversationComputerReviewCredentialDeriver
 */
export class KeyedConversationComputerReviewCredentialDeriver implements ConversationComputerReviewCredentialDeriver
{
	/** Requires one 256-bit key and refuses to start without it. */
	public constructor(private readonly key: Buffer)
	{
		if (key.length !== 32)
			throw new Error("Conversation computer review credential key must be 256 bits");
	}

	/** Builds the deriver from the current key of the Secret-mounted conversation keyring. */
	public static fromKeyring(document: ConversationPrivatePayloadKeyringDocument): KeyedConversationComputerReviewCredentialDeriver
	{
		const encoded = document.keys[document.currentKeyId];
		if (encoded === undefined)
			throw new Error("Conversation computer review credential requires the current keyring key");
		return new KeyedConversationComputerReviewCredentialDeriver(Buffer.from(encoded, "base64url"));
	}

	/** @inheritdoc */
	public derive(coordinates: ConversationComputerReviewCredentialCoordinates): string
	{
		if (!coordinates.siloId || !coordinates.computerId || !coordinates.leaseId || !Number.isSafeInteger(coordinates.generation) || coordinates.generation < 1)
			throw new Error("Conversation computer review credential requires complete lease coordinates");
		return createHmac("sha256", this.key).update(JSON.stringify([_DOMAIN, coordinates.siloId, coordinates.computerId, String(coordinates.generation), coordinates.leaseId])).digest("hex");
	}
}
