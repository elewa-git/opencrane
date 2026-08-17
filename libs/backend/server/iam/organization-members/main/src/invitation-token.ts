import { createHmac, timingSafeEqual } from "node:crypto";

import type { OrganizationInvitationTokenAuthority, OrganizationInvitationTokenCoordinates } from "./invitation-token.types";

/** Version prefix that keeps future token encodings distinguishable. */
const _TOKEN_VERSION = "v1";

/** Encodes token coordinates in one unambiguous signed payload. */
function _payload(coordinates: OrganizationInvitationTokenCoordinates): string
{
	return `${_TOKEN_VERSION}.${Buffer.from(coordinates.invitationId, "utf8").toString("base64url")}.${coordinates.generation}.${coordinates.nonce}`;
}

/** Computes the message authentication code without exposing the signing key. */
function _mac(key: Buffer, payload: string): string
{
	return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

/**
 * Issues and verifies restart-stable invitation bearer tokens.
 *
 * The database keeps only public coordinates and a random nonce. The mounted key authenticates
 * those coordinates, so an idempotent retry can reproduce the same link without storing the bearer
 * token itself. Changing the key invalidates every outstanding invitation and must be an explicit
 * deployment operation.
 *
 * Called by: {@link StandaloneOrganizationMembershipAuthority}.
 * @implements OrganizationInvitationTokenAuthority
 */
export class HmacOrganizationInvitationTokenAuthority implements OrganizationInvitationTokenAuthority
{
	/** Deployment-held key copied once so caller mutation cannot change token verification. */
	private readonly key: Buffer;

	/**
	 * @param key - At least 32 bytes of deployment-held random key material.
	 * @throws When the key is too short for invitation authentication.
	 */
	constructor(key: Uint8Array)
	{
		if (key.byteLength < 32) throw new Error("organization invitation signing key must contain at least 32 bytes");
		this.key = Buffer.from(key);
	}

	/** @inheritdoc */
	issue(coordinates: OrganizationInvitationTokenCoordinates): string
	{
		const payload = _payload(coordinates);
		return `${payload}.${_mac(this.key, payload)}`;
	}

	/** @inheritdoc */
	verify(token: string): OrganizationInvitationTokenCoordinates | null
	{
		const parts = token.split(".");
		if (parts.length !== 5 || parts[0] !== _TOKEN_VERSION) return null;
		const payload = parts.slice(0, 4).join(".");
		const expected = Buffer.from(_mac(this.key, payload), "utf8");
		const supplied = Buffer.from(parts[4] ?? "", "utf8");
		if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) return null;
		const invitationId = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
		const generation = Number(parts[2]);
		const nonce = parts[3] ?? "";
		if (invitationId.length === 0 || !Number.isSafeInteger(generation) || generation < 1 || nonce.length < 16) return null;
		return { invitationId, generation, nonce };
	}
}
