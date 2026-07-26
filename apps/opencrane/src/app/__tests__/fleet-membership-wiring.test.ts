import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { __DigestFleetMembershipSignedPayload } from "@opencrane/backend/server/iam/membership";
import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";

import { _CreateManagedExecutionEvidenceAuthority, _CreateMountedFleetMembershipSignatureVerifier } from "../fleet-membership-wiring.js";

/** Writes one temporary Ed25519 SPKI public key for composition tests. */
function _PublicKeyPath(): string
{
	const directory = mkdtempSync(join(tmpdir(), "opencrane-membership-"));
	const pair = generateKeyPairSync("ed25519");
	const path = join(directory, "public-key.pem");
	writeFileSync(path, pair.publicKey.export({ type: "spki", format: "pem" }));
	return path;
}

/** Signs one complete canonical membership payload with the supplied Ed25519 key. */
function _Revision(privateKey: KeyObject): SignedFleetMembershipRevision
{
	const payload: Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature"> = { revision: 1, issuerId: "fleet-1", issuerKeyId: "fleet-key-1", siloId: "silo-1", issuedAtEpochMs: 1_000, expiresAtEpochMs: 10_000, assertions: [] };
	const payloadDigest = __DigestFleetMembershipSignedPayload(payload);
	return { ...payload, payloadDigest, signature: sign(null, Buffer.from(payloadDigest, "utf8"), privateKey).toString("base64url") };
}

describe("managed fleet membership composition", function ()
{
	it("builds only from complete mounted-key trust configuration", function ()
	{
		expect(_CreateManagedExecutionEvidenceAuthority({
			OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID: "fleet-1",
			OPENCRANE_FLEET_MEMBERSHIP_KEY_ID: "fleet-key-1",
			OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
			OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS: "300000",
		})).toBeDefined();
	});

	it("fails closed for absent trust or an unbounded staleness policy", function ()
	{
		expect(function _missing() { return _CreateManagedExecutionEvidenceAuthority({}); }).toThrow("OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID must be configured");
		expect(function _unbounded()
		{
			return _CreateManagedExecutionEvidenceAuthority({
				OPENCRANE_FLEET_MEMBERSHIP_ISSUER_ID: "fleet-1",
				OPENCRANE_FLEET_MEMBERSHIP_KEY_ID: "fleet-key-1",
				OPENCRANE_FLEET_MEMBERSHIP_PUBLIC_KEY_FILE: _PublicKeyPath(),
				OPENCRANE_FLEET_MEMBERSHIP_MAX_STALENESS_MS: String(24 * 60 * 60 * 1_000 + 1),
			});
		}).toThrow("must be a positive integer");
	});

	it("uses a newly projected public key on the next verification without restarting", async function ()
	{
		const directory = mkdtempSync(join(tmpdir(), "opencrane-membership-rotation-"));
		const path = join(directory, "public-key.pem");
		const first = generateKeyPairSync("ed25519");
		const second = generateKeyPairSync("ed25519");
		writeFileSync(path, first.publicKey.export({ type: "spki", format: "pem" }));
		const verifier = _CreateMountedFleetMembershipSignatureVerifier(path, "fleet-key-1");
		await expect(verifier.verify(_Revision(first.privateKey))).resolves.toMatchObject({ verified: true });

		writeFileSync(path, second.publicKey.export({ type: "spki", format: "pem" }));
		await expect(verifier.verify(_Revision(second.privateKey))).resolves.toMatchObject({ verified: true });
		await expect(verifier.verify(_Revision(first.privateKey))).resolves.toMatchObject({ verified: false });
	});
});
