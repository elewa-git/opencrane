import { describe, expect, it } from "vitest";

import { __ValidateArtifactStorePromotion, __ValidateStageArtifactCommand, __ValidateStagedArtifact, __ValidateVerifiedArtifactWriteLease } from "./artifact-store.js";

/** Builds one valid durable write lease. */
function _lease(): { readonly leaseId: string; readonly siloId: string; readonly artifactId: string; readonly action: "artifact.write"; readonly expiresAtEpochSeconds: number }
{
	return { leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: 1_750_000_100 };
}

describe("ArtifactStore contracts", function _suite()
{
	it("rejects expired or non-artifact write leases before staging", function _leaseValidation()
	{
		expect(__ValidateVerifiedArtifactWriteLease(_lease(), 1_750_000_000)).toBe(true);
		expect(__ValidateVerifiedArtifactWriteLease({ ..._lease(), action: "artifact.read" as "artifact.write" }, 1_750_000_000)).toBe(false);
		expect(__ValidateVerifiedArtifactWriteLease({ ..._lease(), expiresAtEpochSeconds: 1_749_999_999 }, 1_750_000_000)).toBe(false);
	});

	it("accepts only bounded stage metadata with canonical optional digest", function _stageValidation()
	{
		const command = { lease: _lease(), bytes: (async function* _bytes(): AsyncIterable<Uint8Array> { yield Buffer.from("artifact"); })(), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 8, mediaType: "text/plain" };
		expect(__ValidateStageArtifactCommand(command, 1_750_000_000)).toBe(true);
		expect(__ValidateStageArtifactCommand({ ...command, expectedContentAddress: "digest" }, 1_750_000_000)).toBe(false);
		expect(__ValidateStageArtifactCommand({ ...command, expectedByteLength: -1 }, 1_750_000_000)).toBe(false);
	});

	it("keeps staging and promotion values content-addressed", function _promotionValidation()
	{
		const staged = { leaseId: "lease-1", stagingHandle: "staging-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 8, mediaType: "text/plain" };
		expect(__ValidateStagedArtifact(staged)).toBe(true);
		expect(__ValidateArtifactStorePromotion({ ...staged, created: true })).toBe(true);
		expect(__ValidateStagedArtifact({ ...staged, contentAddress: "relative/path" })).toBe(false);
	});
});
