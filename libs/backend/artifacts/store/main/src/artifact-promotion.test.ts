import { describe, expect, it } from "vitest";

import { __PromoteArtifactUpload } from "./artifact-promotion.js";
import type { ArtifactPromotionLeaseClaims, ArtifactPromotionLeaseVerifier, ArtifactPromotionReceiptSigner, ArtifactStore, BoundedArtifactUploadByteSource } from "./artifact-store.types.js";

/** Builds one valid write lease for protocol tests. */
function _lease(expiresAtEpochSeconds: number): ArtifactPromotionLeaseClaims
{
	return { leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds, expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 9, mediaType: "text/plain" };
}

/** Exposes an in-memory byte source and its cancellation observation for protocol tests. */
interface TestByteSource
{
	/** Storage-neutral request source passed into the protocol. */
	readonly source: BoundedArtifactUploadByteSource;
	/** Returns how often the protocol cancelled the source. */
	abortCount(): number;
}

/** Supplies an in-memory byte source that records deadline cancellation. */
function _byteSource(declaredByteLength: string | null = "9"): TestByteSource
{
	let abortCount = 0;
	return {
		source: {
			compactLease: "compact-lease",
			declaredByteLength,
			bytes: (async function* _bytes(): AsyncIterable<Uint8Array> { yield Buffer.from("opencrane"); })(),
			abort() { abortCount += 1; },
		},
		abortCount() { return abortCount; },
	};
}

/** Exposes a fake ArtifactStore and operation observations for protocol tests. */
interface TestStore
{
	/** ArtifactStore port passed into the promotion protocol. */
	readonly store: ArtifactStore;
	/** Returns how often the protocol requested durable staging. */
	stageCount(): number;
	/** Returns how often the protocol requested canonical promotion. */
	promoteCount(): number;
	/** Replaces staging with a test-specific implementation. */
	setStage(implementation: () => Promise<{ readonly leaseId: string; readonly stagingHandle: string; readonly contentAddress: string; readonly byteLength: number; readonly mediaType: string }>): void;
}

/** Creates a fake ArtifactStore that records whether staging and promotion were admitted. */
function _store(): TestStore
{
	const staged = { leaseId: "lease-1", stagingHandle: "staging-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "text/plain" };
	let stageCount = 0;
	let promoteCount = 0;
	let stage = async function _stage(): Promise<typeof staged> { return staged; };
	return {
		store: {
			async stage()
			{
				stageCount += 1;
				return stage();
			},
			async promote()
			{
				promoteCount += 1;
				return { ...staged, created: true };
			},
			async read() { return null; },
			async purge() { return { purged: false }; },
		},
		stageCount() { return stageCount; },
		promoteCount() { return promoteCount; },
		setStage(implementation) { stage = implementation; },
	};
}

/** Uses a lease verifier that is explicit about the test clock and supplied lease. */
function _leaseVerifier(lease: ReturnType<typeof _lease>): ArtifactPromotionLeaseVerifier
{
	return { verify: function _verify() { return lease; } };
}

/** Exposes a receipt signer and whether the protocol admitted it. */
interface TestReceiptSigner
{
	/** Receipt signer port passed into the protocol. */
	readonly signer: ArtifactPromotionReceiptSigner;
	/** Returns the last signed receipt claims, or null when no receipt was signed. */
	claims(): { readonly leaseId: string; readonly issuedAtEpochSeconds: number } | null;
}

/** Uses an observable receipt signer without importing a key implementation into the protocol. */
function _receiptSigner(): TestReceiptSigner
{
	let claims: { readonly leaseId: string; readonly issuedAtEpochSeconds: number } | null = null;
	return {
		signer: { sign(receiptClaims) { claims = receiptClaims; return "signed-receipt"; } },
		claims() { return claims; },
	};
}

describe("ArtifactStore promotion protocol", function _suite()
{
	it("stages, promotes, and signs one receipt only after a verified bounded lease", async function _promotes()
	{
		const now = 1_750_000_000_000;
		const testStore = _store();
		const receiptSigner = _receiptSigner();
		const outcome = await __PromoteArtifactUpload(testStore.store, _leaseVerifier(_lease(Math.floor(now / 1_000) + 60)), _byteSource().source, { maxUploadDurationMilliseconds: 30_000, nowEpochMilliseconds: function _now() { return now; }, receiptSigner: receiptSigner.signer });
		expect(outcome).toMatchObject({ outcome: "promoted", receipt: "signed-receipt", promotion: { leaseId: "lease-1" } });
		expect(testStore.stageCount()).toBe(1);
		expect(testStore.promoteCount()).toBe(1);
		expect(receiptSigner.claims()).toMatchObject({ leaseId: "lease-1", issuedAtEpochSeconds: Math.floor(now / 1_000) });
	});

	it("rejects malformed and oversized content lengths before durable staging", async function _declaredSize()
	{
		const now = 1_750_000_000_000;
		const testStore = _store();
		const outcome = await __PromoteArtifactUpload(testStore.store, _leaseVerifier(_lease(Math.floor(now / 1_000) + 60)), _byteSource("10").source, { maxUploadDurationMilliseconds: 30_000, nowEpochMilliseconds: function _now() { return now; }, receiptSigner: _receiptSigner().signer });
		expect(outcome).toEqual({ outcome: "rejected", reason: "artifact_body_exceeds_lease" });
		expect(testStore.stageCount()).toBe(0);
	});

	it("cancels the source and never signs a receipt after the absolute deadline", async function _deadline()
	{
		const now = Date.now();
		const testStore = _store();
		const byteSource = _byteSource();
		const receiptSigner = _receiptSigner();
		testStore.setStage(async function _slowStage()
		{
			await new Promise<void>(function _delay(resolve) { setTimeout(resolve, 25); });
			return { leaseId: "lease-1", stagingHandle: "staging-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "text/plain" };
		});
		const outcome = await __PromoteArtifactUpload(testStore.store, _leaseVerifier(_lease(Math.floor(now / 1_000) + 60)), byteSource.source, { maxUploadDurationMilliseconds: 5, nowEpochMilliseconds: Date.now, receiptSigner: receiptSigner.signer });
		expect(outcome).toEqual({ outcome: "deadline_exceeded" });
		expect(byteSource.abortCount()).toBe(1);
		expect(testStore.promoteCount()).toBe(0);
		expect(receiptSigner.claims()).toBeNull();
	});
});
