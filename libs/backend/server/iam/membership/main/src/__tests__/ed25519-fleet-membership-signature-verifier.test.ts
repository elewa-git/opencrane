import { generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";

import type { SignedFleetMembershipRevision } from "@opencrane/models/authorization";
import { describe, expect, it } from "vitest";

import { Ed25519FleetMembershipSignatureVerifier } from "../ed25519-fleet-membership-signature-verifier.js";
import { __DigestFleetMembershipSignedPayload } from "../fleet-membership-payload-digest.js";

/** Creates one signed membership revision for cryptographic adapter tests. */
function _Revision(privateKey: KeyObject, issuerKeyId = "fleet-key-1"): SignedFleetMembershipRevision
{
	const payload: Omit<SignedFleetMembershipRevision, "payloadDigest" | "signature"> = {
		revision: 3,
		issuerId: "fleet-1",
		issuerKeyId,
		siloId: "silo-1",
		issuedAtEpochMs: 1_000,
		expiresAtEpochMs: 10_000,
		assertions: [{ assertionId: "assertion-1", siloId: "silo-1", subjectId: "agent-service:service-1", scope: { kind: "project", organizationId: "org-1", projectId: "project-1" } }],
	};
	const payloadDigest = __DigestFleetMembershipSignedPayload(payload);
	return { ...payload, payloadDigest, signature: sign(null, Buffer.from(payloadDigest, "utf8"), privateKey).toString("base64url") };
}

describe("Ed25519FleetMembershipSignatureVerifier", function ()
{
	it("accepts only the exact digest signed by the named Ed25519 key", async function ()
	{
		const pair = generateKeyPairSync("ed25519");
		const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
		const verifier = new Ed25519FleetMembershipSignatureVerifier({ "fleet-key-1": pem });
		const revision = _Revision(pair.privateKey);

		await expect(verifier.verify(revision)).resolves.toMatchObject({ verified: true, issuerKeyId: "fleet-key-1", payloadDigest: revision.payloadDigest });
		await expect(verifier.verify({ ...revision, assertions: [{ ...revision.assertions[0], subjectId: "agent-service:attacker" }] })).resolves.toMatchObject({ verified: false });
		await expect(verifier.verify({ ...revision, payloadDigest: `sha256:${"b".repeat(64)}` })).resolves.toMatchObject({ verified: false });
		await expect(verifier.verify(_Revision(pair.privateKey, "unknown-key"))).resolves.toMatchObject({ verified: false });
	});

	it("rejects non-Ed25519 verification keys at composition time", function ()
	{
		const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
		expect(function _createWithRsa() { return new Ed25519FleetMembershipSignatureVerifier({ "fleet-key-1": pem }); }).toThrow("must be Ed25519");
	});
});
